import type { Address } from 'viem'
import { actionRpcRequest } from '../chain/actionRpc'

function nonceError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error)
  return /nonce too low|replacement|already known|nonce has already been used/i.test(text)
}

export function createNonceManager(getPendingNonce: () => Promise<number>) {
  let next: number | undefined
  let queue = Promise.resolve()

  const resync = async () => {
    next = await getPendingNonce()
    return next
  }

  const send = <T>(sender: (nonce: number) => Promise<T>) => {
    const run = queue.then(async () => {
      if (next == null) await resync()
      const nonce = next!
      try {
        const result = await sender(nonce)
        next = nonce + 1
        return result
      } catch (error) {
        if (!nonceError(error)) throw error
        const retryNonce = await resync()
        const result = await sender(retryNonce)
        next = retryNonce + 1
        return result
      }
    })
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  return { send, resync }
}

const managers = new Map<string, ReturnType<typeof createNonceManager>>()

function manager(address: Address) {
  const key = address.toLowerCase()
  let current = managers.get(key)
  if (!current) {
    current = createNonceManager(() =>
      actionRpcRequest((client) => client.getTransactionCount({ address, blockTag: 'pending' })),
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
