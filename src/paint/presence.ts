/**
 * "Who else is here?" for the shared canvas: who painted in the last few minutes, the latest strokes, and a
 * short-lived outline on the Paint canvas wherever someone else just painted. Everything comes from the core
 * contract's own `Painted` events (no server): live ones from the canvas store, plus one bounded look-back
 * when the OS starts so the counter isn't empty on arrival.
 */
import { hexToBytes, type Hex } from 'viem'
import { getBlockSnapshot } from '../chain/blocks'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { getLogsWindow } from '../chain/logs'
import { R3TARDS_PAINT_ABI } from '../lib/generated/abi'
import { getCanvasSnapshot, subscribeCanvasActivity, type CanvasActivity } from './canvasStore'

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface Stroke {
  key: string
  owner: string
  block: bigint
  pixels: number
  box: Box
  tx?: Hex
}

export interface Ping {
  id: number
  box: Box
  self: boolean
  until: number
}

export interface SeasonStats {
  season: bigint
  paints: bigint
  frames: bigint
}

export interface PresenceSnapshot {
  version: number
  strokes: readonly Stroke[]
  /** first block the look-back covered; the counter never claims more than it saw */
  coveredFrom?: bigint
  pings: readonly Ping[]
  /** set when something asks Paint to show a spot ("Show me", a click on a recent stroke) */
  focus?: { id: number; box: Box }
  season?: SeasonStats
}

/** "Active recently" means painted within about the last minute at Monad block times. */
export const PRESENCE_WINDOW_BLOCKS = 200n
/** One look-back at start; capped by the RPC's log range so a public RPC sees at most ~10 small requests. */
export const BACKFILL_CHUNKS = 10
export const PING_MS = 3_000
export const MAX_STROKES = 400
const SEASON_REFRESH_MS = 60_000

/** Runs are 4-byte groups: y, x0, x1, colour. Returns how many pixels a stroke wrote and the box around them. */
export function strokeFromRuns(runs: Uint8Array): { pixels: number; box: Box } | undefined {
  let pixels = 0
  let x0 = 256
  let y0 = 256
  let x1 = -1
  let y1 = -1
  for (let offset = 0; offset + 3 < runs.length; offset += 4) {
    const y = runs[offset]
    const start = runs[offset + 1]
    const end = runs[offset + 2]
    if (end < start) continue
    pixels += end - start + 1
    if (start < x0) x0 = start
    if (end > x1) x1 = end
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return pixels ? { pixels, box: { x0, y0, x1, y1 } } : undefined
}

/** The 64 × 64 regions named by a `regionsMask` (bit n = region n, 4 × 4 grid, row-major). */
export function regionBoxes(mask: number): Box[] {
  const boxes: Box[] = []
  for (let region = 0; region < 16; region++) {
    if (!((mask >> region) & 1)) continue
    const x0 = (region % 4) * 64
    const y0 = Math.floor(region / 4) * 64
    boxes.push({ x0, y0, x1: x0 + 63, y1: y0 + 63 })
  }
  return boxes
}

export function strokeKey(row: {
  transactionHash?: Hex | null
  logIndex?: number | null
  blockNumber: bigint
}) {
  return `${row.transactionHash ?? row.blockNumber.toString()}:${row.logIndex ?? 0}`
}

/** Different wallets and pixels painted in the window ending at `head`. Live mode paints count for their owner. */
export function summarize(strokes: readonly Stroke[], head: bigint, windowBlocks = PRESENCE_WINDOW_BLOCKS) {
  const from = head > windowBlocks ? head - windowBlocks : 0n
  const painters = new Set<string>()
  let pixels = 0
  let count = 0
  for (const stroke of strokes) {
    if (stroke.block < from || stroke.block > head) continue
    painters.add(stroke.owner)
    pixels += stroke.pixels
    count += 1
  }
  return { painters: painters.size, pixels, strokes: count }
}

/** Human label for the recent-activity window, from the block time this browser measured. */
export function windowLabel(windowBlocks: bigint, blockMs: number) {
  const ms = Number(windowBlocks) * (Number.isFinite(blockMs) && blockMs > 0 ? blockMs : 400)
  const minutes = Math.max(1, Math.round(ms / 60_000))
  return `~${minutes} min`
}

/** "8 s", "3 min", "1 h": how long ago a block was, from the measured block time. */
export function agoLabel(block: bigint, head: bigint, blockMs: number) {
  const blocks = head > block ? Number(head - block) : 0
  const seconds = Math.round((blocks * (blockMs > 0 ? blockMs : 400)) / 1_000)
  if (seconds < 60) return `${seconds} s`
  if (seconds < 3_600) return `${Math.round(seconds / 60)} min`
  return `${Math.round(seconds / 3_600)} h`
}

/** Newest first, de-duplicated, capped. */
export function mergeStrokes(current: readonly Stroke[], incoming: readonly Stroke[], max = MAX_STROKES) {
  const byKey = new Map<string, Stroke>()
  for (const stroke of current) byKey.set(stroke.key, stroke)
  for (const stroke of incoming) byKey.set(stroke.key, stroke)
  return [...byKey.values()]
    .sort((a, b) => (a.block === b.block ? 0 : a.block > b.block ? -1 : 1))
    .slice(0, max)
}

export function strokeFromActivity(activity: CanvasActivity): Stroke | undefined {
  if (activity.eventName !== 'Painted' || !activity.runs || !activity.owner) return undefined
  const shape = strokeFromRuns(hexToBytes(activity.runs))
  if (!shape) return undefined
  return {
    key: strokeKey(activity),
    owner: activity.owner.toLowerCase(),
    block: activity.blockNumber,
    pixels: shape.pixels,
    box: shape.box,
    tx: activity.transactionHash,
  }
}

// ---- store ----

type Listener = () => void
const listeners = new Set<Listener>()
let snapshot: PresenceSnapshot = { version: 0, strokes: [], pings: [] }
let nextPing = 1
let nextFocus = 1
let pingTimer: ReturnType<typeof setTimeout> | undefined
let started = false
let ownAccount: string | undefined

function emit(next: Partial<PresenceSnapshot>) {
  snapshot = { ...snapshot, ...next, version: snapshot.version + 1 }
  for (const listener of listeners) listener()
}

export function getPresenceSnapshot() {
  return snapshot
}

export function subscribePresence(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Paint passes the connected wallet so its own strokes are drawn as "you" and not pinged. */
export function setPresenceAccount(account: string | undefined) {
  ownAccount = account?.toLowerCase()
}

function schedulePrune() {
  if (pingTimer) clearTimeout(pingTimer)
  if (!snapshot.pings.length) return
  const soonest = Math.min(...snapshot.pings.map((ping) => ping.until))
  pingTimer = setTimeout(
    () => {
      const now = Date.now()
      emit({ pings: snapshot.pings.filter((ping) => ping.until > now) })
      schedulePrune()
    },
    Math.max(50, soonest - Date.now()),
  )
}

/** Outline these boxes on the Paint canvas for a moment. Never touches canvas data. */
export function pingBoxes(boxes: readonly Box[], self = false, ms = PING_MS) {
  if (!boxes.length) return
  const until = Date.now() + ms
  const added = boxes.map((box) => ({ id: nextPing++, box, self, until }))
  emit({ pings: [...snapshot.pings.filter((ping) => ping.until > Date.now()), ...added].slice(-24) })
  schedulePrune()
}

/** Ask Paint to scroll to a spot (Paint consumes `focus`), and outline it unless the caller outlines its own boxes. */
export function focusPaint(box: Box, outline = true) {
  emit({ focus: { id: nextFocus++, box } })
  if (outline) pingBoxes([box], false, PING_MS)
}

function addStrokes(incoming: Stroke[], live: boolean) {
  if (!incoming.length) return
  const fresh = incoming.filter((stroke) => !snapshot.strokes.some((row) => row.key === stroke.key))
  const season = snapshot.season
  emit({
    strokes: mergeStrokes(snapshot.strokes, incoming),
    // Count live paints right away; the next seasonInfo read corrects any drift.
    season:
      live && season && season.season === getCanvasSnapshot().season
        ? { ...season, paints: season.paints + BigInt(fresh.length) }
        : season,
  })
  if (live) {
    const others = incoming.filter((stroke) => stroke.owner !== ownAccount)
    pingBoxes(others.map((stroke) => stroke.box))
  }
}

const paintedEvent = (R3TARDS_PAINT_ABI as readonly { type: string; name?: string }[]).find(
  (item) => item.type === 'event' && item.name === 'Painted',
)

async function backfill() {
  if (!publicClient || !config.paintAddress || !paintedEvent) return
  const head = (await publicClient.getBlockNumber({ cacheTime: 0 })) as bigint
  const span = BigInt(Math.min(Number(PRESENCE_WINDOW_BLOCKS), BACKFILL_CHUNKS * config.logsRange))
  const fromBlock = head > span ? head - span + 1n : 0n
  const logs = (await getLogsWindow({
    address: config.paintAddress,
    event: paintedEvent,
    fromBlock,
    toBlock: head,
    maxBlocks: span,
  })) as {
    args?: { owner?: string; runs?: Hex }
    blockNumber: bigint
    logIndex?: number
    transactionHash?: Hex
  }[]
  const strokes: Stroke[] = []
  for (const log of logs) {
    const stroke = strokeFromActivity({
      eventName: 'Painted',
      owner: log.args?.owner,
      runs: log.args?.runs,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      transactionHash: log.transactionHash,
    })
    if (stroke) strokes.push(stroke)
  }
  emit({ coveredFrom: fromBlock })
  addStrokes(strokes, false)
}

async function refreshSeason() {
  if (!publicClient || !config.paintAddress) return
  if (typeof document !== 'undefined' && document.hidden) return
  const season = getCanvasSnapshot().season
  const info = (await publicClient.readContract({
    address: config.paintAddress,
    abi: R3TARDS_PAINT_ABI,
    functionName: 'seasonInfo',
    args: [season],
  })) as readonly unknown[]
  emit({ season: { season, frames: BigInt(info[4] as bigint), paints: BigInt(info[7] as bigint) } })
}

/** Started once by the OS, after the canvas store. Demo mode keeps it empty. */
export function startPresence() {
  if (started) return
  started = true
  subscribeCanvasActivity((activity) => {
    const stroke = strokeFromActivity(activity)
    if (stroke) addStrokes([stroke], true)
  })
  if (config.demo) return
  // Let boot, the canvas and the block clock have the RPC first.
  setTimeout(() => {
    void backfill().catch(() => emit({ coveredFrom: getBlockSnapshot().block }))
    void refreshSeason().catch(() => undefined)
  }, 2_500)
  setInterval(() => void refreshSeason().catch(() => undefined), SEASON_REFRESH_MS)
}

export function __resetPresenceForTests() {
  snapshot = { version: 0, strokes: [], pings: [] }
  ownAccount = undefined
  if (pingTimer) clearTimeout(pingTimer)
}
