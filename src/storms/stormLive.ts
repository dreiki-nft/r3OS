/**
 * Storms that the leaderboard file hasn't counted yet (the one happening now, or one that just ended before
 * the next refresh): who has painted in them so far, read straight from the Paint contract's `Painted` events.
 * Live paints arrive through the canvas store; opening Storm Chasers mid-storm backfills the window once.
 * It also rings once per storm when the connected wallet's own paint lands inside one: "storm caught".
 * Read-only, no server. The leaderboard file stays the official count (it also leaves out team wallets).
 */
import { getBlockSnapshot } from '../chain/blocks'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { getLogsWindow } from '../chain/logs'
import { getWalletSnapshot } from '../chain/wallet'
import { R3OS_PAINT_ABI } from '../lib/generated/abi'
import { pushBalloon } from '../os/balloons'
import { subscribeCanvasActivity } from '../paint/canvasStore'
import { STORM_PERIOD, stormNumber } from './stormBoard'

const STORM_LENGTH = 600n
type Listener = () => void

/** storm start block → painters (lowercase) seen in that storm. */
const painters = new Map<string, Set<string>>()
const loaded = new Set<string>()
const announced = new Set<string>()
const listeners = new Set<Listener>()
let version = 0
let started = false

const paintedEvent = (R3OS_PAINT_ABI as readonly { type: string; name?: string }[]).find(
  (item) => item.type === 'event' && item.name === 'Painted',
)

/** The storm a block falls in (its start block), or undefined between storms. */
export function stormStartAt(block: bigint) {
  const offset = block % STORM_PERIOD
  return offset < STORM_LENGTH ? block - offset : undefined
}

function emit() {
  version++
  for (const listener of listeners) listener()
}

function add(start: bigint, owner: string) {
  const key = start.toString()
  const set = painters.get(key) ?? new Set<string>()
  if (set.has(owner)) return false
  set.add(owner)
  painters.set(key, set)
  return true
}

export function noteStormPaint(owner: string, block: bigint, me = getWalletSnapshot().account) {
  const start = stormStartAt(block)
  if (start == null) return
  const lower = owner.toLowerCase()
  const added = add(start, lower)
  const key = start.toString()
  // Only ring for a paint that just landed: catch-up logs replayed at boot must not announce an old storm.
  const head = getBlockSnapshot().block
  const fresh = head === 0n || head - block < 100n
  if (me && fresh && lower === me.toLowerCase() && !announced.has(key)) {
    announced.add(key)
    const number = stormNumber(start)
    pushBalloon({
      id: `storm-caught-${key}`,
      icon: 'lightning',
      title: number ? `Storm ${number} caught ⚡` : 'Storm caught ⚡',
      body: number
        ? '+1 raffle ticket. it shows on the Storm Chasers board after the next update.'
        : 'you painted during a DF1 storm.',
      href: '#/storms',
      hrefLabel: 'Storm Chasers',
    })
  }
  if (added) emit()
}

/** Start listening (from app start): live paints only, no RPC. */
export function startStormWatch() {
  if (started) return
  started = true
  subscribeCanvasActivity((activity) => {
    if (activity.eventName !== 'Painted' || !activity.owner) return
    noteStormPaint(activity.owner, activity.blockNumber)
  })
}

/** Read every paint of one storm window from the chain once (for storms already running or just ended). */
export async function loadStorm(start: bigint) {
  const key = start.toString()
  if (loaded.has(key) || !publicClient || !config.paintAddress || !paintedEvent) return
  const head = getBlockSnapshot().block
  if (head < start) return
  loaded.add(key)
  const toBlock = head < start + STORM_LENGTH - 1n ? head : start + STORM_LENGTH - 1n
  try {
    const logs = (await getLogsWindow({
      address: config.paintAddress,
      event: paintedEvent,
      fromBlock: start,
      toBlock,
      maxBlocks: STORM_LENGTH,
    })) as { args?: { owner?: string } }[]
    let changed = false
    for (const log of logs) if (log.args?.owner) changed = add(start, log.args.owner.toLowerCase()) || changed
    // Seen in the backfill: don't ring for a storm the wallet caught before this page loaded.
    const me = getWalletSnapshot().account?.toLowerCase()
    if (me && painters.get(key)?.has(me)) announced.add(key)
    if (changed) emit()
  } catch {
    loaded.delete(key) // try again next time the window opens
  }
}

export function stormPainters(start: bigint): ReadonlySet<string> {
  return painters.get(start.toString()) ?? new Set()
}

export function getStormLiveVersion() {
  return version
}

export function subscribeStormLive(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Season storms that have started but aren't in the leaderboard file yet (at most the last two). */
export function uncountedStorms(head: bigint, counted: number, firstStorm: bigint, totalStorms: number) {
  const out: { number: number; start: bigint; live: boolean }[] = []
  for (let n = counted + 1; n <= totalStorms; n++) {
    const start = firstStorm + BigInt(n - 1) * STORM_PERIOD
    if (start > head) break
    out.push({ number: n, start, live: head < start + STORM_LENGTH })
  }
  return out.slice(-2)
}

export function __resetStormLiveForTests() {
  painters.clear()
  loaded.clear()
  announced.clear()
  version = 0
}
