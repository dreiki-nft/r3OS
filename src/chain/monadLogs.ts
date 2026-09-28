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

export async function subscribeMonadLogs(addresses: readonly Address[]) {
  if (!wsClient || !addresses.length) throw new Error('monadLogs unavailable')
  const transport = wsClient.transport as unknown as SubscribableTransport
  if (typeof transport.subscribe !== 'function') throw new Error('monadLogs unavailable')
  const handle = await transport.subscribe({
    params: ['monadLogs', { address: addresses }],
    onData: (data) => {
      const notification = decodeMonadNotification(data)
      if (!notification?.transactionHash) return
      markTraceCommit(notification.transactionHash, notification.commitState, notification.blockNumber)
    },
    onError: () => {
      // X-ray retains its plain-log/receipt fallback.
    },
  })
  return () => {
    void handle.unsubscribe()
  }
}
