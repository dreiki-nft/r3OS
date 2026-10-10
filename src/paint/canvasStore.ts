import { hexToBytes, type Hex, type Log } from 'viem'
import { recordPerf, recordPerfSampled } from '../chain/perf'
import { publicClient, wsClient } from '../chain/clients'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { readMany } from '../chain/readMany'
import { config } from '../chain/config'
import { getLogsWindow } from '../chain/logs'
import { subscribeMonadLogNotifications, type MonadLogNotification } from '../chain/monadLogs'
import { ProposalCommitmentTracker } from '../chain/speculation'
export { chunkBlockRanges } from '../chain/logs'
import { decodeCoreEventLog } from '../chain/coreLogs'
import { demoConstants, readCoreConstants, seasonAtTimestamp } from '../chain/contracts'
import { R3OS_PAINT_ABI } from '../lib/generated/abi'
import { OUTLINE_MASK } from '../lib/layers'
import { decodePackedCanvas } from '../lib/patch'
import { applyPainted, expandOutlineRuns } from './replay'
import type { TilePreviewState } from './cost'

export interface CanvasSnapshot {
  background: Uint8Array
  working: Uint8Array
  outline: Uint8Array
  season: bigint
  face: number
  backgroundColor: number
  snapshotBlock: bigint
  status: 'demo' | 'live' | 'polling' | 'offline'
  /** newest websocket-delivered paint that this canvas snapshot contains */
  renderProbe?: { key: string; observedAt: number; owner: string }
}

export interface TileCacheEntry {
  state: TilePreviewState
  block: bigint
  stale: boolean
}

export interface TileCacheSnapshot {
  version: number
  map: ReadonlyMap<number, TileCacheEntry>
}

export interface CanvasActivity {
  eventName: string
  owner?: string
  minter?: string
  from?: string
  to?: string
  sessionKey?: string
  tokenId?: bigint
  season?: bigint
  seasonFrameIndex?: bigint
  rendererId?: bigint
  transactionHash?: Hex
  blockNumber: bigint
  logIndex?: number | null
  runs?: Hex
  units?: bigint
  regionsMask?: number
}

export interface ActivityFeedSnapshot {
  version: number
  items: readonly CanvasActivity[]
}

/**
 * Read the Painted event's spent-unit field without letting an ABI/name mismatch crash receipt settlement.
 * The deployed R3OSPaint event names this field `unitsSpent`; `units` is accepted only as a legacy/client alias.
 */
export function paintedUnitsFromArgs(args: Record<string, unknown>): bigint | undefined {
  const raw = args.unitsSpent ?? args.units
  if (raw == null) return undefined
  try {
    return BigInt(raw as bigint)
  } catch {
    return undefined
  }
}

type CoreLog = {
  blockHash?: Hex | null
  blockNumber: bigint
  logIndex?: number | null
  transactionHash?: Hex | null
  data: Hex
  topics: readonly Hex[]
}

const blank = () => new Uint8Array(65_536)
let snapshot: CanvasSnapshot = {
  background: blank(),
  working: blank(),
  outline: OUTLINE_MASK.slice(),
  season: 0n,
  face: 1,
  backgroundColor: 0,
  snapshotBlock: 0n,
  status: config.demo ? 'demo' : 'offline',
}
const canvasListeners = new Set<() => void>()
const activityListeners = new Set<(activity: CanvasActivity) => void>()
const activityFeedListeners = new Set<() => void>()
const tileListeners = new Set<() => void>()
const tileCache = new Map<number, TileCacheEntry>()
let tileSnapshot: TileCacheSnapshot = { version: 0, map: tileCache }
let unwatch: (() => void) | undefined
let unwatchMonadNotifications: (() => void) | undefined
let pollTimer: number | undefined
let reconcileTimer: number | undefined
let serial = Promise.resolve()
let started = false
let startPromise: Promise<void> | undefined
let constants = demoConstants
let activityFeed: ActivityFeedSnapshot = { version: 0, items: [] }
const appliedLogKeys = new Map<string, bigint>()
/**
 * Logs delivered outside the serial queue (websocket, receipts), newest last. A full canvas reload reads the
 * contract at one block while these keep arriving; anything newer than that block is applied again on top of
 * the reloaded canvas, or a stroke that landed mid-reload would vanish until the next reconcile.
 */
const recentDelivered: CoreLog[] = []
const RECENT_DELIVERED_MAX = 512
let logsSubscribed = false
let retryLogsAt = 0
let lastBlockMode: string | undefined
let unwatchBlockMode: (() => void) | undefined
const LOGS_RETRY_MS = 15_000
// Each polling loop owns a generation, so a tick still awaiting its catch-up cannot start a second loop.
let pollGeneration = 0
const proposalCommitments = new ProposalCommitmentTracker()

function emitCanvas() {
  for (const listener of canvasListeners) listener()
}

function emitTiles() {
  tileSnapshot = { version: tileSnapshot.version + 1, map: tileCache }
  for (const listener of tileListeners) listener()
}

function emitActivityNow(activity: CanvasActivity) {
  activityFeed = {
    version: activityFeed.version + 1,
    items: [...activityFeed.items, activity].slice(-600),
  }
  for (const listener of activityListeners) listener(activity)
  for (const listener of activityFeedListeners) listener()
}

export function getCanvasSnapshot() {
  return snapshot
}

export function subscribeCanvas(listener: () => void) {
  canvasListeners.add(listener)
  return () => {
    canvasListeners.delete(listener)
  }
}

export function subscribeCanvasActivity(listener: (activity: CanvasActivity) => void) {
  activityListeners.add(listener)
  return () => {
    activityListeners.delete(listener)
  }
}

export function getActivityFeedSnapshot() {
  return activityFeed
}

export function subscribeActivityFeed(listener: () => void) {
  activityFeedListeners.add(listener)
  return () => {
    activityFeedListeners.delete(listener)
  }
}

export function getTileCacheSnapshot() {
  return tileSnapshot
}

export function subscribeTileCache(listener: () => void) {
  tileListeners.add(listener)
  return () => {
    tileListeners.delete(listener)
  }
}

function preservePending(nextBase: Uint8Array) {
  const next = nextBase.slice()
  for (let index = 0; index < next.length; index++) {
    if (snapshot.working[index] !== snapshot.background[index]) next[index] = snapshot.working[index]
  }
  return next
}

export function setWorking(next: Uint8Array) {
  snapshot = { ...snapshot, working: next }
  emitCanvas()
}

export function clearPending() {
  snapshot = { ...snapshot, working: snapshot.background.slice() }
  emitCanvas()
}

export function createSerialQueue() {
  let queue = Promise.resolve()
  return <T>(job: () => Promise<T>) => {
    const run = queue.then(job, job)
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

function enqueue<T>(job: () => Promise<T>) {
  const run = serial.then(job, job)
  serial = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function sortLogs<T extends { blockNumber: bigint; logIndex?: number | null }>(logs: readonly T[]) {
  return [...logs].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1
    return Number(a.logIndex ?? 0) - Number(b.logIndex ?? 0)
  })
}

export function tilesTouchedByPainted(runs: Uint8Array, corruptions: Uint8Array) {
  const touched = new Set<number>()
  for (let offset = 0; offset + 3 < runs.length; offset += 4) {
    const y = runs[offset]
    for (let x = runs[offset + 1]; x <= runs[offset + 2]; x++) touched.add((y >> 4) * 16 + (x >> 4))
  }
  for (let offset = 0; offset + 2 < corruptions.length; offset += 3) {
    const x = corruptions[offset]
    const y = corruptions[offset + 1]
    touched.add((y >> 4) * 16 + (x >> 4))
  }
  return touched
}

export function markTilesStale(tiles: Iterable<number>) {
  let changed = false
  for (const tile of tiles) {
    const entry = tileCache.get(tile)
    if (entry && !entry.stale) {
      tileCache.set(tile, { ...entry, stale: true })
      changed = true
    }
  }
  if (changed) emitTiles()
}

function decodeCoreLog(log: CoreLog) {
  try {
    return decodeCoreEventLog(log)
  } catch {
    return undefined
  }
}

function outlineChange(eventName: string) {
  return (
    eventName === 'SeasonOutlineSet' ||
    eventName === 'SeasonOutlineAppended' ||
    eventName === 'SeasonOutlineCleared' ||
    eventName === 'SeasonFinaleMinted'
  )
}

export function canvasLogIdentity(log: {
  blockHash?: Hex | null
  transactionHash?: Hex | null
  logIndex?: number | null
}) {
  if (!log.transactionHash || log.logIndex == null) return undefined
  const txLog = `${log.transactionHash.toLowerCase()}:${log.logIndex}`
  // A transaction/log index pair is not enough to distinguish sibling Monad proposals.
  // Prefer blockHash when the provider supplies it; receipts without one retain the legacy fallback.
  return log.blockHash ? `${log.blockHash.toLowerCase()}:${txLog}` : txLog
}

function rememberLog(log: CoreLog) {
  const key = canvasLogIdentity(log)
  if (key) appliedLogKeys.set(key, log.blockNumber)
}

export function logSetsDiffer(applied: Iterable<string>, canonical: Iterable<string>) {
  const left = new Set(applied)
  const right = new Set(canonical)
  if (left.size !== right.size) return true
  for (const key of left) if (!right.has(key)) return true
  return false
}

export async function reloadOnSpeculativeMismatch(
  applied: Iterable<string>,
  canonical: Iterable<string>,
  reload: () => Promise<void>,
) {
  if (!logSetsDiffer(applied, canonical)) return false
  await reload()
  return true
}

function pruneApplied(beforeBlock: bigint) {
  for (const [key, block] of appliedLogKeys) if (block < beforeBlock) appliedLogKeys.delete(key)
}

function rememberDelivered(log: CoreLog) {
  recentDelivered.push(log)
  if (recentDelivered.length > RECENT_DELIVERED_MAX) recentDelivered.splice(0, recentDelivered.length - RECENT_DELIVERED_MAX)
}

/** Logs that arrived while the canvas was being read at `block` and are newer than it. */
export function deliveredAfter(logs: readonly CoreLog[], block: bigint) {
  return logs.filter((log) => log.blockNumber > block)
}

async function seedCanonicalOverlap(latest: bigint) {
  if (!publicClient || !config.paintAddress) return
  const fromBlock = latest > 32n ? latest - 32n : 0n
  const logs = (await getLogsWindow({
    address: config.paintAddress,
    fromBlock,
    toBlock: latest,
    maxBlocks: 33,
  })) as unknown as CoreLog[]
  pruneApplied(fromBlock)
  for (const log of logs) {
    const key = canvasLogIdentity(log)
    if (key) appliedLogKeys.set(key, log.blockNumber)
  }
}

async function applyDeliveredLogs(
  logs: readonly CoreLog[],
  options: {
    advanceSnapshot?: boolean
    observedAt?: number
    source?: 'websocket'
    onPaint?: () => void
    /** re-applying logs after a reload: the activity feed already showed them */
    replay?: boolean
  } = {},
) {
  if (!logs.length) return false
  const advanceSnapshot = options.advanceSnapshot ?? true
  const emitActivity = options.replay ? () => undefined : emitActivityNow
  let needsReload = false
  let canvasChanged = false
  let decodedPaints = 0
  let decodeMs = 0
  let applyMs = 0
  const profileWebsocket = options.source === 'websocket'
  const perfNow = () => (typeof performance === 'undefined' ? Date.now() : performance.now())
  for (const log of sortLogs(logs)) {
    const key = canvasLogIdentity(log)
    if (key && appliedLogKeys.has(key)) continue
    rememberLog(log)
    if (!options.replay) rememberDelivered(log)
    const decodeStarted = profileWebsocket ? perfNow() : 0
    const decoded = decodeCoreLog(log)
    if (profileWebsocket) decodeMs += perfNow() - decodeStarted
    if (!decoded) continue
    const eventName = decoded.eventName
    const args = decoded.args as Record<string, unknown>
    const common = {
      eventName,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      transactionHash: log.transactionHash ?? undefined,
    }
    if (outlineChange(eventName)) needsReload = true
    if (eventName === 'Painted') {
      decodedPaints++
      options.onPaint?.()
      const applyStarted = profileWebsocket ? perfNow() : 0
      const season = BigInt(args.season as bigint)
      if (season !== snapshot.season) {
        needsReload = true
      } else {
        const runsBytes = hexToBytes(args.runs as Hex)
        const corruptions = hexToBytes(args.corruptions as Hex)
        const background = applyPainted(snapshot.background, snapshot.outline, runsBytes, corruptions)
        snapshot = { ...snapshot, background, working: preservePending(background) }
        canvasChanged = true
        markTilesStale(tilesTouchedByPainted(runsBytes, corruptions))
      }
      const owner = String(args.owner ?? '')
      const sender = String(args.sender ?? '')
      if (options.source === 'websocket' && options.observedAt != null && key) {
        snapshot = {
          ...snapshot,
          renderProbe: { key, observedAt: options.observedAt, owner: owner.toLowerCase() },
        }
        canvasChanged = true
      }
      if (profileWebsocket) applyMs += perfNow() - applyStarted
      const units = paintedUnitsFromArgs(args)
      emitActivity({
        ...common,
        owner,
        ...(sender && sender.toLowerCase() !== owner.toLowerCase() ? { sessionKey: sender } : {}),
        runs: args.runs as Hex,
        ...(units != null ? { units } : {}),
        regionsMask: Number(args.regionsMask ?? 0),
      })
    } else if (eventName === 'FaceChanged') {
      snapshot = { ...snapshot, face: Number(args.color) }
      canvasChanged = true
      emitActivity({ ...common, owner: String(args.owner ?? '') })
    } else if (eventName === 'BackgroundChanged') {
      snapshot = { ...snapshot, backgroundColor: Number(args.color) }
      canvasChanged = true
      emitActivity({ ...common, owner: String(args.owner ?? '') })
    } else if (eventName === 'FrameMinted') {
      emitActivity({
        ...common,
        minter: String(args.minter ?? ''),
        tokenId: BigInt(args.frameId as bigint),
        season: BigInt(args.season as bigint),
        seasonFrameIndex: BigInt(args.seasonFrameIndex as bigint),
      })
    } else if (eventName === 'SeasonFinaleMinted') {
      emitActivity({
        ...common,
        minter: String(args.recipient ?? ''),
        tokenId: BigInt(args.tokenId as bigint),
        season: BigInt(args.season as bigint),
      })
    } else if (eventName === 'Transfer') {
      emitActivity({
        ...common,
        from: String(args.from ?? ''),
        to: String(args.to ?? ''),
        tokenId: BigInt(args.tokenId as bigint),
      })
    } else if (eventName === 'TokenRendererSet') {
      emitActivity({
        ...common,
        tokenId: BigInt(args.tokenId as bigint),
        rendererId: BigInt(args.rendererId as bigint),
      })
    } else if (eventName === 'SessionStarted' || eventName === 'SessionRevoked') {
      emitActivity({
        ...common,
        owner: String(args.owner ?? ''),
        sessionKey: String(args.sessionKey ?? ''),
      })
    } else if (!outlineChange(eventName)) {
      emitActivity(common)
    }
    if (advanceSnapshot && log.blockNumber > snapshot.snapshotBlock) {
      snapshot = { ...snapshot, snapshotBlock: log.blockNumber }
      canvasChanged = true
    }
  }
  if (profileWebsocket && decodedPaints > 0) {
    recordPerfSampled('event-decode', 'websocket Paint log decode', decodeMs, 4)
    recordPerfSampled('event-apply', 'Paint replay → canvas store', applyMs, 4)
  }
  if (canvasChanged) emitCanvas()
  return needsReload
}

async function loadCanvasAt(block: bigint, options: { replayDelivered?: boolean } = {}) {
  if (!publicClient || !config.paintAddress) {
    emitCanvas()
    return
  }
  const season = (await publicClient.readContract({
    address: config.paintAddress,
    abi: R3OS_PAINT_ABI,
    functionName: 'currentSeason',
    blockNumber: block,
  })) as bigint
  const [packed, info, custom] = await Promise.all([
    publicClient.readContract({
      address: config.paintAddress,
      abi: R3OS_PAINT_ABI,
      functionName: 'getBackgroundCanvas',
      blockNumber: block,
    }) as Promise<Hex>,
    publicClient.readContract({
      address: config.paintAddress,
      abi: R3OS_PAINT_ABI,
      functionName: 'seasonInfo',
      args: [season],
      blockNumber: block,
    }) as Promise<readonly unknown[]>,
    publicClient.readContract({
      address: config.paintAddress,
      abi: R3OS_PAINT_ABI,
      functionName: 'hasCustomOutline',
      args: [season],
      blockNumber: block,
    }) as Promise<boolean>,
  ])
  let outline = OUTLINE_MASK.slice()
  if (custom) {
    const runs = (await publicClient.readContract({
      address: config.paintAddress,
      abi: R3OS_PAINT_ABI,
      functionName: 'seasonOutlineRuns',
      args: [season],
      blockNumber: block,
    })) as Hex
    outline = expandOutlineRuns(new Uint8Array(hexToBytes(runs)))
  }
  const background = decodePackedCanvas(packed)
  if (import.meta.env.DEV && snapshot.snapshotBlock !== 0n && snapshot.season === season) {
    for (let index = 0; index < background.length; index++) {
      if (background[index] !== snapshot.background[index]) {
        console.warn('canvas replay mismatch at pixel', index, snapshot.background[index], background[index])
        break
      }
    }
  }
  snapshot = {
    background,
    working: preservePending(background),
    outline,
    season,
    face: Number(info[2]),
    backgroundColor: Number(info[3]),
    snapshotBlock: block,
    status: wsClient && logsSubscribed ? 'live' : 'polling',
  }
  tileCache.clear()
  appliedLogKeys.clear()
  await seedCanonicalOverlap(block)
  // Strokes the websocket or a receipt delivered during the reload, on top of the fresh canvas. Not advancing
  // snapshotBlock keeps any catch-up reading from `block`; the remembered keys stop double application.
  // A reconcile repair passes false: it distrusts what was delivered and re-reads the tail canonically.
  const tail = options.replayDelivered === false ? [] : deliveredAfter(recentDelivered, block)
  if (tail.length) await applyDeliveredLogs(tail, { advanceSnapshot: false, replay: true })
  emitTiles()
  emitCanvas()
}

export async function loadCanvasNow() {
  if (!publicClient || !config.paintAddress) {
    emitCanvas()
    return
  }
  const block = await publicClient.getBlockNumber({ cacheTime: 0 })
  await loadCanvasAt(block)
}

async function finalizedBlockNumber() {
  if (!publicClient) return undefined
  const block = await publicClient.getBlock({ blockTag: 'finalized' })
  return block.number ?? undefined
}

export function loadCanvas() {
  return enqueue(loadCanvasNow)
}

function estimatedSeasonNow() {
  const unix = BigInt(Math.floor(Date.now() / 1_000))
  return seasonAtTimestamp(unix, constants)
}

export async function catchUpNow(targetBlock?: bigint) {
  if (!publicClient || !config.paintAddress) return
  const latest = targetBlock ?? (await publicClient.getBlockNumber({ cacheTime: 0 }))
  if (estimatedSeasonNow() !== snapshot.season) {
    await loadCanvasNow()
    return
  }
  if (latest <= snapshot.snapshotBlock) return
  const gap = latest - snapshot.snapshotBlock
  if (gap > BigInt(20 * config.logsRange)) {
    await loadCanvasNow()
    return
  }
  let needsReload = false
  const logs = (await getLogsWindow({
    address: config.paintAddress,
    fromBlock: snapshot.snapshotBlock + 1n,
    toBlock: latest,
  })) as unknown as CoreLog[]
  if (await applyDeliveredLogs(logs)) needsReload = true
  if (needsReload) {
    await loadCanvasNow()
    return
  }
  if (latest > snapshot.snapshotBlock) {
    snapshot = { ...snapshot, snapshotBlock: latest }
    emitCanvas()
  }
}

export function catchUp(targetBlock?: bigint) {
  return enqueue(() => catchUpNow(targetBlock))
}

async function onSubscriptionLogs(logs: readonly unknown[]) {
  const observedAt = typeof performance === 'undefined' ? Date.now() : performance.now()
  const typed = logs as CoreLog[]
  let freshPaint = false
  const needsReload = await applyDeliveredLogs(typed, {
    observedAt,
    source: 'websocket',
    onPaint: () => {
      freshPaint = true
    },
  })
  if (freshPaint) {
    const storedAt = typeof performance === 'undefined' ? Date.now() : performance.now()
    recordPerf('paint-stream', 'websocket Paint event → canvas store', Math.max(0, storedAt - observedAt))
  }
  if (needsReload) await loadCanvas()
}

async function reconcileSpeculativeNowImpl(targetFinalizedBlock?: bigint) {
  if (!publicClient || !config.paintAddress) return false
  const finalized = targetFinalizedBlock ?? (await finalizedBlockNumber())
  if (finalized == null) return false

  // Reconcile only against finalized state. On Monad, `latest` may be Proposed and therefore
  // cannot certify away a losing speculative proposal.
  const anchor = snapshot.snapshotBlock < finalized ? snapshot.snapshotBlock : finalized
  const fromBlock = anchor > 32n ? anchor - 32n : 0n
  if (finalized - fromBlock + 1n > BigInt(20 * config.logsRange)) {
    await loadCanvasAt(finalized, { replayDelivered: false })
    await catchUpNow()
    return true
  }
  const logs = (await getLogsWindow({
    address: config.paintAddress,
    fromBlock,
    toBlock: finalized,
  })) as unknown as CoreLog[]
  const canonical = logs.map(canvasLogIdentity).filter((key): key is string => Boolean(key))
  const applied = [...appliedLogKeys.entries()]
    .filter(([, block]) => block >= fromBlock && block <= finalized)
    .map(([key]) => key)
  if (
    await reloadOnSpeculativeMismatch(applied, canonical, async () => {
      await loadCanvasAt(finalized, { replayDelivered: false })
      // Re-apply the post-finalized tail so low-latency UX can continue after the authoritative repair.
      await catchUpNow()
    })
  ) {
    return true
  }
  pruneApplied(fromBlock)
  return false
}

export function reconcileSpeculativeNow(targetFinalizedBlock?: bigint) {
  return enqueue(() => reconcileSpeculativeNowImpl(targetFinalizedBlock))
}

function onMonadCanvasCommitment(notification: MonadLogNotification) {
  const paint = config.paintAddress?.toLowerCase()
  const relevantActivity = Boolean(paint && notification.log?.address?.toLowerCase() === paint)
  const decision = proposalCommitments.observe({
    blockId: notification.blockId,
    blockNumber: notification.blockNumber,
    commitState: notification.commitState,
    relevantActivity,
  })
  if (decision.shouldReconcile && decision.blockNumber != null) {
    void reconcileSpeculativeNow(decision.blockNumber).catch(() => undefined)
  }
}

export function startCanvasStore() {
  if (started) return Promise.resolve()
  if (startPromise) return startPromise

  const pending = (async () => {
    constants = await readCoreConstants().catch(() => demoConstants)
    await loadCanvas()
    unwatchMonadNotifications?.()
    unwatchMonadNotifications = subscribeMonadLogNotifications(onMonadCanvasCommitment)
    if (wsClient && config.paintAddress) {
      subscribeLogs()
      // The block clock notices a stalled socket (no newHeads) and when headers flow again; the Paint log
      // subscription rides the same socket, so it follows: HTTP catch-up while stalled, websocket after.
      lastBlockMode = getBlockSnapshot().mode
      unwatchBlockMode = subscribeBlocks(() => {
        const mode = getBlockSnapshot().mode
        if (mode === lastBlockMode) return
        lastBlockMode = mode
        if (mode === 'polling' && logsSubscribed) fallBackToPolling()
        else if (mode === 'live' && !logsSubscribed) resumeSubscription()
      })
    } else {
      startPolling()
    }
    reconcileTimer = window.setInterval(() => void reconcileSpeculativeNow(), 30_000)
    started = true
  })().finally(() => {
    if (startPromise === pending) startPromise = undefined
  })
  startPromise = pending
  return pending
}

function setLogsSubscribed(live: boolean) {
  logsSubscribed = live
  const status = live ? 'live' : 'polling'
  if (snapshot.status === status || snapshot.status === 'demo') return
  snapshot = { ...snapshot, status }
  emitCanvas()
}

function subscribeLogs() {
  if (!wsClient || !config.paintAddress) return
  unwatch?.()
  unwatch = wsClient.watchContractEvent({
    address: config.paintAddress,
    abi: R3OS_PAINT_ABI,
    onLogs: (logs) => void onSubscriptionLogs(logs),
    onError: () => fallBackToPolling(),
  })
  setLogsSubscribed(true)
}

function fallBackToPolling() {
  retryLogsAt = Date.now() + LOGS_RETRY_MS
  void catchUp()
    .catch(() => undefined)
    .finally(startPolling)
}

/** Back from HTTP polling to the websocket: subscribe first, then one catch-up closes the gap between them. */
function resumeSubscription() {
  pollGeneration++
  if (pollTimer) window.clearTimeout(pollTimer)
  pollTimer = undefined
  subscribeLogs()
  void catchUp().catch(() => undefined)
}

function startPolling() {
  unwatch?.()
  unwatch = undefined
  setLogsSubscribed(false)
  const generation = ++pollGeneration
  const tick = async () => {
    if (!document.hidden) await catchUp().catch(() => undefined)
    if (generation !== pollGeneration || logsSubscribed) return
    // The socket is healthy again (headers arrive on it) and the last failure is old: try the subscription again.
    if (wsClient && getBlockSnapshot().mode === 'live' && Date.now() >= retryLogsAt) {
      resumeSubscription()
      return
    }
    pollTimer = window.setTimeout(tick, document.hidden ? 5_000 : 1_000)
  }
  if (pollTimer) window.clearTimeout(pollTimer)
  void tick()
}

export function stopCanvasStore() {
  unwatch?.()
  unwatch = undefined
  unwatchBlockMode?.()
  unwatchBlockMode = undefined
  logsSubscribed = false
  pollGeneration++
  unwatchMonadNotifications?.()
  unwatchMonadNotifications = undefined
  proposalCommitments.reset()
  if (pollTimer) window.clearTimeout(pollTimer)
  if (reconcileTimer) window.clearInterval(reconcileTimer)
  started = false
}

export function beginInFlight(runs: Uint8Array) {
  const sent = new Map<number, number>()
  for (let offset = 0; offset + 3 < runs.length; offset += 4) {
    const y = runs[offset]
    const colour = runs[offset + 3]
    for (let x = runs[offset + 1]; x <= runs[offset + 2]; x++) sent.set(y * 256 + x, colour)
  }
  return sent
}

export function clearMatchingInFlight(
  working: Uint8Array,
  background: Uint8Array,
  sent: ReadonlyMap<number, number>,
) {
  const next = working.slice()
  for (const [index, colour] of sent) {
    if (next[index] === colour) next[index] = background[index]
  }
  return next
}

export async function settleInFlight(sent: ReadonlyMap<number, number>, receiptBlock: bigint) {
  await catchUp(receiptBlock)
  if (snapshot.snapshotBlock < receiptBlock) await catchUp()
  snapshot = {
    ...snapshot,
    working: clearMatchingInFlight(snapshot.working, snapshot.background, sent),
  }
  emitCanvas()
}

/**
 * Fast path for our own included transaction. The receipt already contains the exact Painted log,
 * including DF1 corruptions, so apply it immediately instead of waiting for another getLogs round trip.
 * We deliberately do not advance snapshotBlock here: another painter can share the same block, and the
 * normal websocket/catch-up path still needs to see those sibling logs. Duplicate receipt/subscription
 * logs are de-duplicated by txHash:logIndex.
 */
export function receiptCoreLogs(
  receiptLogs: readonly Log[],
  receiptBlock: bigint,
  paintAddress = config.paintAddress,
): CoreLog[] {
  const expected = paintAddress?.toLowerCase()
  return receiptLogs.flatMap((log) => {
    if (!log.data || !log.topics || (expected && log.address.toLowerCase() !== expected)) return []
    return [
      {
        blockHash: log.blockHash ?? undefined,
        blockNumber: log.blockNumber ?? receiptBlock,
        logIndex: log.logIndex == null ? null : Number(log.logIndex),
        transactionHash: log.transactionHash ?? undefined,
        data: log.data,
        topics: log.topics as readonly Hex[],
      },
    ]
  })
}

export async function settleInFlightFromReceipt(
  sent: ReadonlyMap<number, number>,
  receiptLogs: readonly Log[],
  receiptBlock: bigint,
) {
  const coreLogs = receiptCoreLogs(receiptLogs, receiptBlock)
  const hasPainted = coreLogs.some((log) => decodeCoreLog(log)?.eventName === 'Painted')

  if (!hasPainted) {
    // Unexpected receipt shape. Keep the canonical serialized path rather than making the stroke disappear.
    return enqueue(async () => {
      await catchUpNow(receiptBlock)
      snapshot = {
        ...snapshot,
        working: clearMatchingInFlight(snapshot.working, snapshot.background, sent),
      }
      emitCanvas()
    })
  }

  // Receipt inclusion is stronger evidence for this transaction than an older queued getLogs/reconcile read.
  // Apply the exact Painted log immediately, matching the websocket fast path, so a slow public RPC cannot
  // strand a locally confirmed stroke behind the reconciliation queue for seconds. Canonical overlap repair
  // still runs in the background and remains authoritative for sibling transactions/reorg detection.
  const needsReload = await applyDeliveredLogs(coreLogs, { advanceSnapshot: false })
  if (needsReload) {
    return enqueue(async () => {
      await loadCanvasNow()
      snapshot = {
        ...snapshot,
        working: clearMatchingInFlight(snapshot.working, snapshot.background, sent),
      }
      emitCanvas()
    })
  }

  snapshot = {
    ...snapshot,
    working: clearMatchingInFlight(snapshot.working, snapshot.background, sent),
  }
  emitCanvas()
  void catchUp(receiptBlock).catch(() => undefined)
}

/**
 * Apply Paint-contract receipt logs immediately after inclusion, even for writes that do not include a Painted event
 * (for example mintFrame, face/background changes, transfers and renderer changes). This keeps dependent UI
 * stores in sync with the receipt instead of waiting for a websocket or a possibly lagging read RPC.
 */
export function applyReceiptActivity(receiptLogs: readonly Log[], receiptBlock: bigint) {
  return enqueue(async () => {
    const coreLogs = receiptCoreLogs(receiptLogs, receiptBlock)
    if (!coreLogs.length) return
    const needsReload = await applyDeliveredLogs(coreLogs, { advanceSnapshot: false })
    if (needsReload) await loadCanvasNow()
    void catchUp(receiptBlock).catch(() => undefined)
  })
}

export function tileNeedsFetch(cached: TileCacheEntry | undefined, headBlock: bigint, force = false) {
  return force || !cached || cached.stale || headBlock - cached.block > 10n
}

export async function readTileState(tile: number, headBlock: bigint, force = false) {
  if (!publicClient || !config.paintAddress) return undefined
  const cached = tileCache.get(tile)
  if (!tileNeedsFetch(cached, headBlock, force)) return cached!.state
  const result = (await publicClient.readContract({
    address: config.paintAddress,
    abi: R3OS_PAINT_ABI,
    functionName: 'tileState',
    args: [snapshot.season, tile],
  })) as readonly bigint[]
  const state = { heat: Number(result[1]), wetBitmap: result[2] }
  tileCache.set(tile, { state, block: headBlock, stale: false })
  emitTiles()
  return state
}

export async function readTileStates(tiles: readonly number[], headBlock: bigint, force = false) {
  const client = publicClient
  if (!client || !config.paintAddress) return new Map<number, TilePreviewState>()
  const needed = [...new Set(tiles)].filter((tile) => {
    const cached = tileCache.get(tile)
    return tileNeedsFetch(cached, headBlock, force)
  })
  if (needed.length) {
    // Heat view can need all 256 tiles at once. Use Multicall3 instead of emitting
    // hundreds of individual eth_call requests into the public-RPC limiter.
    const results = (await readMany(
      needed.map((tile) => ({
        address: config.paintAddress!,
        abi: R3OS_PAINT_ABI,
        functionName: 'tileState',
        args: [snapshot.season, tile],
      })),
      { allowFailure: false },
    )) as readonly (readonly bigint[])[]
    results.forEach((result, index) => {
      tileCache.set(needed[index], {
        state: { heat: Number(result[1]), wetBitmap: result[2] },
        block: headBlock,
        stale: false,
      })
    })
    emitTiles()
  }
  const out = new Map<number, TilePreviewState>()
  for (const tile of tiles) {
    const entry = tileCache.get(tile)
    if (entry) out.set(tile, entry.state)
  }
  return out
}

export function __applyLogsForTests(logs: readonly CoreLog[]) {
  return applyDeliveredLogs(logs)
}

export function __setAppliedLogKeysForTests(entries: readonly [string, bigint][]) {
  appliedLogKeys.clear()
  for (const [key, block] of entries) appliedLogKeys.set(key, block)
}
