import type { Address } from 'viem'
import { actionRpcRequest } from '../chain/actionRpc'
import { config } from '../chain/config'
import { withTabLock } from './burner'

function nonceError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  return /nonce too low|replacement|already known|nonce has already been used/i.test(text)
}

/**
 * Tabs of one browser share a burner, so they must not hand out the same nonce: the second transaction would be
 * rejected or, with a higher fee, silently replace the first tab's stroke. `shared` serialises the
 * nonce-assign-and-broadcast step across tabs and carries the next nonce from tab to tab.
 */
export interface SharedNonce {
  lock: <T>(task: () => Promise<T>) => Promise<T>
  read: () => number | undefined
  write: (next: number) => void
}

export function createNonceManager(getPendingNonce: () => Promise<number>, shared?: SharedNonce) {
  let next: number | undefined
  let queue = Promise.resolve()
  const lock = shared?.lock ?? (<T>(task: () => Promise<T>) => task())

  const resync = async () => {
    next = await getPendingNonce()
    return next
  }

  const send = <T>(sender: (nonce: number) => Promise<T>) => {
    const run = queue.then(() =>
      lock(async () => {
        if (next == null) await resync()
        // Another tab sent since this tab's last transaction: continue after its nonce.
        const fromOtherTab = shared?.read()
        if (fromOtherTab != null && fromOtherTab > next!) next = fromOtherTab
        const nonce = next!
        try {
          const result = await sender(nonce)
          next = nonce + 1
          shared?.write(next)
          return result
        } catch (error) {
          if (!nonceError(error)) throw error
          // Trust the chain only: a shared value could point past a transaction that was dropped.
          const retryNonce = await resync()
          const result = await sender(retryNonce)
          next = retryNonce + 1
          shared?.write(next)
          return result
        }
      }),
    )
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  return { send, resync }
}

const SHARED_NONCE_TTL_MS = 10 * 60_000

function sharedNonce(address: Address): SharedNonce {
  const key = `r3os.burnerNonce.${config.chainId}.${address.toLowerCase()}`
  return {
    lock: (task) => withTabLock(key, task),
    read: () => {
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? 'null') as {
          next?: unknown
          at?: unknown
        } | null
        // Only a recent hand-off counts; after a while the chain's pending nonce is the better source.
        if (typeof value?.next !== 'number' || typeof value.at !== 'number') return undefined
        return Date.now() - value.at < SHARED_NONCE_TTL_MS ? value.next : undefined
      } catch {
        return undefined
      }
    },
    write: (next) => {
      try {
        localStorage.setItem(key, JSON.stringify({ next, at: Date.now() }))
      } catch {
        // Storage can be blocked; the nonce-error retry still recovers.
      }
    },
  }
}

const managers = new Map<string, ReturnType<typeof createNonceManager>>()

function manager(address: Address) {
  const key = address.toLowerCase()
  let current = managers.get(key)
  if (!current) {
    current = createNonceManager(
      () => actionRpcRequest((client) => client.getTransactionCount({ address, blockTag: 'pending' })),
      sharedNonce(address),
    )
    managers.set(key, current)
  }
  return current
}

export function sendWithBurnerNonce<T>(address: Address, sender: (nonce: number) => Promise<T>) {
  return manager(address).send(sender)
}

export function resetBurnerNonce(address: Address) {
  return manager(address).resync()
}

export function __resetNonceManagersForTests() {
  managers.clear()
}
