import { publicClient, wsClient } from './clients'
import { demoConstants, readCoreConstants } from './contracts'

type Listener = () => void

export interface BlockSnapshot {
  block: bigint
  blockTimeMs: number
  storm: boolean
  stormId?: bigint
  stormStart?: bigint
  stormEndsIn: bigint
  nextStormIn: bigint
  mode: 'live' | 'polling' | 'offline'
}

let constants = demoConstants
let snapshot: BlockSnapshot = {
  block: 0n,
  blockTimeMs: 300,
  storm: false,
  stormEndsIn: 0n,
  nextStormIn: 0n,
  mode: 'offline',
}
const listeners = new Set<Listener>()
let lastAt = 0
let stopWatch: (() => void) | undefined
let pollTimer: number | undefined

export function isStormAt(
  block: bigint,
  period = constants.STORM_PERIOD_BLOCKS,
  length = constants.STORM_LENGTH_BLOCKS,
) {
  return block % period < length
}

export function emaBlockTime(previousMs: number, elapsedMs: number, blocks: number) {
  return previousMs * 0.8 + (elapsedMs / Math.max(1, blocks)) * 0.2
}

export function stormCountdown(
  block: bigint,
  period = constants.STORM_PERIOD_BLOCKS,
  length = constants.STORM_LENGTH_BLOCKS,
) {
  const offset = block % period
  return offset < length
    ? { stormEndsIn: length - offset, nextStormIn: 0n }
    : { stormEndsIn: 0n, nextStormIn: period - offset }
}

function accept(block: bigint, mode: BlockSnapshot['mode']) {
  const now = typeof performance === 'undefined' ? Date.now() : performance.now()
  if (lastAt && block > snapshot.block) {
    snapshot = {
      ...snapshot,
      blockTimeMs: emaBlockTime(snapshot.blockTimeMs, now - lastAt, Number(block - snapshot.block)),
    }
  }
  lastAt = now
  const countdown = stormCountdown(block)
  const storm = isStormAt(block)
  const stormId = storm ? block / constants.STORM_PERIOD_BLOCKS : undefined
  const stormStart = stormId == null ? undefined : stormId * constants.STORM_PERIOD_BLOCKS
  snapshot = { ...snapshot, block, storm, stormId, stormStart, ...countdown, mode }
  for (const listener of listeners) listener()
}

export function getBlockSnapshot() {
  return snapshot
}

export function subscribeBlocks(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function startBlockClock() {
  constants = await readCoreConstants().catch(() => demoConstants)
  if (!publicClient) return
  const initial = await publicClient.getBlockNumber({ cacheTime: 0 }).catch(() => 0n)
  accept(initial, wsClient ? 'live' : 'polling')

  if (wsClient) {
    stopWatch = wsClient.watchBlockNumber({
      onBlockNumber: (block) => accept(block, 'live'),
      onError: () => startPolling(),
    })
  } else {
    startPolling()
  }
}

function startPolling() {
  stopWatch?.()
  stopWatch = undefined
  const poll = async () => {
    if (!publicClient) return
    const block = await publicClient.getBlockNumber({ cacheTime: 0 }).catch(() => snapshot.block)
    accept(block, 'polling')
    pollTimer = window.setTimeout(poll, document.hidden ? 5_000 : 400)
  }
  if (pollTimer) window.clearTimeout(pollTimer)
  void poll()
}

export function stopBlockClock() {
  stopWatch?.()
  if (pollTimer) window.clearTimeout(pollTimer)
}

export function blockEta(blocks: bigint) {
  return Number(blocks) * snapshot.blockTimeMs
}
