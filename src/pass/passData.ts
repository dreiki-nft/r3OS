import type { Address } from 'viem'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { discoverContracts } from '../chain/contracts'
import { resolveHolderIds } from '../chain/holders'
import { readMany } from '../chain/readMany'
import { R3OS_PAINTER_PASS_ABI } from '../lib/generated/abi'

export interface PassIdentityData {
  passAddress?: Address
  collection?: Address
  passId: bigint
  hasClaimed: boolean
  holderIds: bigint[]
}

type Entry = {
  value?: PassIdentityData
  fetchedAt: number
  promise?: Promise<PassIdentityData>
}

const FRESH_MS = 8_000
const cache = new Map<string, Entry>()

function key(owner: Address) {
  return `${config.chainId}:${config.paintAddress?.toLowerCase() ?? 'no-paint'}:${owner.toLowerCase()}`
}

/** Shared boot/My Pass identity read. A short TTL removes the cold-open duplicate without hiding changes. */
export function readPassIdentity(owner: Address, force = false): Promise<PassIdentityData> {
  const cacheKey = key(owner)
  const existing = cache.get(cacheKey)
  if (!force && existing?.value && Date.now() - existing.fetchedAt < FRESH_MS) {
    return Promise.resolve(existing.value)
  }
  if (existing?.promise) return existing.promise

  const entry: Entry = existing ?? { fetchedAt: 0 }
  const pending = (async () => {
    if (!publicClient) return { passId: 0n, hasClaimed: false, holderIds: [] }
    const contracts = await discoverContracts()
    if (!contracts.pass || !contracts.r3tards) {
      return {
        passAddress: contracts.pass,
        collection: contracts.r3tards,
        passId: 0n,
        hasClaimed: false,
        holderIds: [],
      }
    }
    const [identity, holderIds] = await Promise.all([
      readMany(
        [
          {
            address: contracts.pass,
            abi: R3OS_PAINTER_PASS_ABI,
            functionName: 'passOf',
            args: [owner],
          },
          {
            address: contracts.pass,
            abi: R3OS_PAINTER_PASS_ABI,
            functionName: 'hasClaimed',
            args: [owner],
          },
        ],
        { allowFailure: false },
      ),
      resolveHolderIds(publicClient, contracts.r3tards, owner),
    ])
    return {
      passAddress: contracts.pass,
      collection: contracts.r3tards,
      passId: BigInt(identity[0] as bigint),
      hasClaimed: Boolean(identity[1]),
      holderIds,
    }
  })()
    .then((value) => {
      entry.value = value
      entry.fetchedAt = Date.now()
      return value
    })
    .finally(() => {
      if (entry.promise === pending) entry.promise = undefined
    })
  entry.promise = pending
  cache.set(cacheKey, entry)
  return pending
}

export function invalidatePassIdentity(owner?: Address) {
  if (!owner) cache.clear()
  else cache.delete(key(owner))
}

export function __resetPassIdentityForTests() {
  cache.clear()
}
