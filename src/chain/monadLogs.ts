import { hexToBigInt, type Address, type Hex } from 'viem'
import { wsClient } from './clients'
import { markTraceCommit, type CommitState } from './txTrace'

export interface MonadLogNotification {
  blockId?: Hex
  blockNumber?: bigint
  commitState: CommitState
  transactionHash?: Hex
}

interface SubscriptionHandle {
  unsubscribe: () => Promise<boolean> | boolean | void
}

interface SubscribableTransport {
  subscribe: (args: {
    params: readonly unknown[]
    onData: (data: unknown) => void
    onError: (error: Error) => void
  }) => Promise<SubscriptionHandle>
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

function blockNumber(value: unknown): bigint | undefined {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
  if (typeof value === 'string' && value.startsWith('0x')) {
    try {
      return hexToBigInt(value as Hex)
    } catch {
      return undefined
    }
  }
  return undefined
}

function blockId(value: unknown): Hex | undefined {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value) ? (value as Hex) : undefined
}

export function decodeMonadNotification(value: unknown): MonadLogNotification | undefined {
  let current = object(value)
  for (let depth = 0; depth < 4 && current; depth++) {
    const commitState = current.commitState
    const log = object(current.log)
    const transactionHash = current.transactionHash ?? log?.transactionHash
    if (
      (commitState === 'Proposed' ||
        commitState === 'Voted' ||
        commitState === 'Finalized' ||
        commitState === 'Verified') &&
      (transactionHash == null || (typeof transactionHash === 'string' && transactionHash.startsWith('0x')))
    ) {
      return {
        blockId: blockId(current.blockId),
        blockNumber: blockNumber(log?.blockNumber),
        commitState,
        transactionHash: transactionHash as Hex | undefined,
      }
    }
    current = object(current.result ?? current.data ?? current.params)
  }
  return undefined
}

export async function subscribeMonadLogs(
  addresses: readonly Address[],
  onNotification?: (notification: MonadLogNotification) => void,
  onSubscriptionError?: (error: Error) => void,
) {
  if (!wsClient || !addresses.length) throw new Error('monadLogs unavailable')
  const transport = wsClient.transport as unknown as SubscribableTransport
  if (typeof transport.subscribe !== 'function') throw new Error('monadLogs unavailable')
  const handle = await transport.subscribe({
    params: ['monadLogs', { address: addresses }],
    onData: (data) => {
      const notification = decodeMonadNotification(data)
      if (!notification) return
      onNotification?.(notification)
      if (!notification.transactionHash) return
      markTraceCommit(notification.transactionHash, notification.commitState, notification.blockNumber)
    },
    onError: (error) => {
      onSubscriptionError?.(error)
    },
  })
  return () => {
    void handle.unsubscribe()
  }
}


export type MonadTraceFeedMode = 'idle' | 'connecting' | 'live' | 'unavailable'

interface MonadTraceFeedSnapshot {
  version: number
  mode: MonadTraceFeedMode
}

const traceFeedListeners = new Set<() => void>()
let traceFeedSnapshot: MonadTraceFeedSnapshot = { version: 0, mode: 'idle' }
let traceFeedStart: Promise<void> | undefined
let stopTraceFeed: (() => void) | undefined
let traceFeedAddresses: Address[] = []
let traceFeedGeneration = 0
let traceFeedFailures = 0
let traceRetryTimer: ReturnType<typeof setTimeout> | undefined
const TRACE_RETRY_DELAYS_MS = [1_500, 5_000] as const

function setTraceFeedMode(mode: MonadTraceFeedMode) {
  if (traceFeedSnapshot.mode === mode) return
  traceFeedSnapshot = { version: traceFeedSnapshot.version + 1, mode }
  for (const listener of traceFeedListeners) listener()
}

export function subscribeMonadTraceFeed(listener: () => void) {
  traceFeedListeners.add(listener)
  return () => traceFeedListeners.delete(listener)
}

export function getMonadTraceFeedSnapshot() {
  return traceFeedSnapshot
}

function scheduleTraceReconnect(generation: number) {
  if (generation !== traceFeedGeneration || traceRetryTimer) return
  setTraceFeedMode('unavailable')
  traceFeedFailures += 1
  const delay = TRACE_RETRY_DELAYS_MS[traceFeedFailures - 1]
  if (delay == null) return
  traceRetryTimer = setTimeout(() => {
    if (generation !== traceFeedGeneration) return
    traceRetryTimer = undefined
    traceFeedStart = undefined
    stopTraceFeed?.()
    stopTraceFeed = undefined
    traceFeedStart = connectTraceFeed(generation)
  }, delay)
}

function connectTraceFeed(generation: number) {
  setTraceFeedMode('connecting')
  let failed = false
  const started = subscribeMonadLogs(
    traceFeedAddresses,
    undefined,
    () => {
      if (generation !== traceFeedGeneration || failed) return
      failed = true
      stopTraceFeed?.()
      stopTraceFeed = undefined
      scheduleTraceReconnect(generation)
    },
  )
    .then((stop) => {
      if (generation !== traceFeedGeneration) {
        stop()
        return
      }
      if (failed) {
        stop()
        return
      }
      stopTraceFeed = stop
      traceFeedFailures = 0
      setTraceFeedMode('live')
    })
    .catch(() => {
      if (generation !== traceFeedGeneration || failed) return
      failed = true
      scheduleTraceReconnect(generation)
    })
  return started
}

/**
 * Start one app-wide commit-state feed. Keeping this alive from boot means X-ray can show commit states
 * for a paint that happened before the X-ray window was opened. Ordinary receipt/log observations never
 * synthesize Proposed/Voted/Finalized states; only decoded monadLogs notifications reach markTraceCommit.
 * A live feed that drops gets two bounded reconnect attempts; an RPC that does not support monadLogs is
 * then left unavailable instead of being hammered forever.
 */
export function startMonadTraceFeed(addresses: readonly Address[]) {
  if (traceFeedStart) return traceFeedStart
  traceFeedAddresses = [...new Set(addresses.map((address) => address.toLowerCase() as Address))]
  if (!traceFeedAddresses.length) {
    setTraceFeedMode('unavailable')
    traceFeedStart = Promise.resolve()
    return traceFeedStart
  }
  traceFeedGeneration += 1
  traceFeedFailures = 0
  traceFeedStart = connectTraceFeed(traceFeedGeneration)
  return traceFeedStart
}

/** Explicit user-facing retry after the bounded automatic attempts are exhausted. */
export function restartMonadTraceFeed(addresses: readonly Address[]) {
  traceFeedGeneration += 1
  if (traceRetryTimer) clearTimeout(traceRetryTimer)
  traceRetryTimer = undefined
  stopTraceFeed?.()
  stopTraceFeed = undefined
  traceFeedStart = undefined
  traceFeedAddresses = []
  traceFeedFailures = 0
  setTraceFeedMode('idle')
  return startMonadTraceFeed(addresses)
}

export function __resetMonadTraceFeedForTests() {
  traceFeedGeneration += 1
  if (traceRetryTimer) clearTimeout(traceRetryTimer)
  traceRetryTimer = undefined
  stopTraceFeed?.()
  stopTraceFeed = undefined
  traceFeedStart = undefined
  traceFeedAddresses = []
  traceFeedFailures = 0
  traceFeedSnapshot = { version: 0, mode: 'idle' }
  traceFeedListeners.clear()
}
