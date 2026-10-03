import { zeroAddress, type Address, type Hex } from 'viem'
import { publicClient, wsClient } from './clients'
import { demoConstants, readCoreConstants } from './contracts'

type Listener = () => void

export interface BlockHeaderSnapshot {
  number: bigint
  timestamp: bigint
  miner: Address
  hash?: Hex
  gasUsed?: bigint
  gasLimit?: bigint
}

export interface BlockSnapshot {
  block: bigint
  timestamp: bigint
  miner: Address
  hash?: Hex
  gasUsed?: bigint
  gasLimit?: bigint
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
  timestamp: 0n,
  miner: zeroAddress,
  blockTimeMs: 300,
  storm: false,
  stormEndsIn: 0n,
  nextStormIn: 0n,
  mode: 'offline',
}
const listeners = new Set<Listener>()
let stopWatch: (() => void) | undefined
let pollTimer: number | undefined
let lastAt = 0
let lastHeader: BlockHeaderSnapshot | undefined

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

export function normalizeHeader(value: unknown): BlockHeaderSnapshot {
  const header = value as {
    number?: bigint | null
    timestamp?: bigint
    miner?: Address | null
    hash?: Hex | null
    gasUsed?: bigint | null
    gasLimit?: bigint | null
  }
  return {
    number: header.number ?? 0n,
    timestamp: header.timestamp ?? 0n,
    miner: header.miner ?? zeroAddress,
    ...(header.hash ? { hash: header.hash } : {}),
    ...(header.gasUsed != null ? { gasUsed: header.gasUsed } : {}),
    ...(header.gasLimit != null ? { gasLimit: header.gasLimit } : {}),
  }
}

export async function readLatestHeader(client: {
  getBlock: (args: { blockTag: 'latest'; includeTransactions: false }) => Promise<unknown>
}) {
  return normalizeHeader(await client.getBlock({ blockTag: 'latest', includeTransactions: false }))
}

function accept(header: BlockHeaderSnapshot, mode: BlockSnapshot['mode']) {
  const now = typeof performance === 'undefined' ? Date.now() : performance.now()
  if (lastHeader && lastAt && header.number > lastHeader.number) {
    snapshot = {
      ...snapshot,
      blockTimeMs: emaBlockTime(
        snapshot.blockTimeMs,
        now - lastAt,
        Number(header.number - lastHeader.number),
      ),
    }
  }
  lastAt = now
  lastHeader = header
  const countdown = stormCountdown(header.number)
  const storm = isStormAt(header.number)
  const stormId = storm ? header.number / constants.STORM_PERIOD_BLOCKS : undefined
  const stormStart = stormId == null ? undefined : stormId * constants.STORM_PERIOD_BLOCKS
  const sameBlock = header.number === snapshot.block
  snapshot = {
    ...snapshot,
    block: header.number,
    timestamp: header.timestamp,
    miner: header.miner,
    // Never carry one block's note inputs into the next. A transient refresh of the same block may reuse the
    // last complete header, but a genuinely new header missing a field stays unknown.
    hash: header.hash ?? (sameBlock ? snapshot.hash : undefined),
    gasUsed: header.gasUsed ?? (sameBlock ? snapshot.gasUsed : undefined),
    gasLimit: header.gasLimit ?? (sameBlock ? snapshot.gasLimit : undefined),
    storm,
    stormId,
    stormStart,
    ...countdown,
    mode,
  }
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

let clockStarted = false

export async function startBlockClock() {
  // React StrictMode runs mount effects twice in dev; one clock only, or polling doubles.
  if (clockStarted) return
  clockStarted = true
  constants = await readCoreConstants().catch(() => demoConstants)
  if (!publicClient) return
  const initial = await readLatestHeader(publicClient as never).catch(() => ({
    number: 0n,
    timestamp: 0n,
    miner: zeroAddress,
  }))
  accept(initial, wsClient ? 'live' : 'polling')

  if (wsClient) {
    stopWatch = (wsClient as any).watchBlocks({
      includeTransactions: false,
      onBlock: (header: unknown) => accept(normalizeHeader(header), 'live'),
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
    const header = await readLatestHeader(publicClient as never).catch(() => ({
      number: snapshot.block,
      timestamp: snapshot.timestamp,
      miner: snapshot.miner,
    }))
    accept(header, 'polling')
    pollTimer = window.setTimeout(poll, document.hidden ? 5_000 : 400)
  }
  if (pollTimer) window.clearTimeout(pollTimer)
  void poll()
}

export function stopBlockClock() {
  stopWatch?.()
  if (pollTimer) window.clearTimeout(pollTimer)
  clockStarted = false
}

export function blockEta(blocks: bigint) {
  return Number(blocks) * snapshot.blockTimeMs
}

export function __setBlockSnapshotForTests(next: Partial<BlockSnapshot>) {
  snapshot = { ...snapshot, ...next }
  lastHeader = {
    number: snapshot.block,
    timestamp: snapshot.timestamp,
    miner: snapshot.miner,
    gasUsed: snapshot.gasUsed,
    gasLimit: snapshot.gasLimit,
  }
}
