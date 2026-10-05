import type { Address } from 'viem'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { discoverContracts } from '../chain/contracts'
import { resolveHolderIds } from '../chain/holders'
import { readMany } from '../chain/readMany'
import { R3OS_PAINTER_PASS_ABI } from '../lib/generated/abi'

export interface PassCoreIdentityData {
  passAddress?: Address
  collection?: Address
  passId: bigint
  hasClaimed: boolean
}

export interface PassIdentityData extends PassCoreIdentityData {
  holderIds: bigint[]
}

type Entry<T> = {
  value?: T
  fetchedAt: number
  promise?: Promise<T>
}

const FRESH_MS = 8_000
const coreCache = new Map<string, Entry<PassCoreIdentityData>>()
const cache = new Map<string, Entry<PassIdentityData>>()

function key(owner: Address) {
  return `${config.chainId}:${config.paintAddress?.toLowerCase() ?? 'no-paint'}:${owner.toLowerCase()}`
}

/**
 * Lightweight identity needed to make My Pass usable. Holder-token discovery is intentionally excluded:
 * on non-enumerable collections that can require several RPC strategies and must not hold the program open.
 */
export function readPassCoreIdentity(owner: Address, force = false): Promise<PassCoreIdentityData> {
  const cacheKey = key(owner)
  const existing = coreCache.get(cacheKey)
  if (!force && existing?.value && Date.now() - existing.fetchedAt < FRESH_MS) {
    return Promise.resolve(existing.value)
  }
  if (existing?.promise) return existing.promise

  const entry: Entry<PassCoreIdentityData> = existing ?? { fetchedAt: 0 }
  const pending = (async () => {
    if (!publicClient) return { passId: 0n, hasClaimed: false }
    const contracts = await discoverContracts()
    if (!contracts.pass) {
      return {
        passAddress: contracts.pass,
        collection: contracts.r3tards,
        passId: 0n,
        hasClaimed: false,
      }
    }
    const identity = await readMany(
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
    )
    return {
      passAddress: contracts.pass,
      collection: contracts.r3tards,
      passId: BigInt(identity[0] as bigint),
      hasClaimed: Boolean(identity[1]),
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
  coreCache.set(cacheKey, entry)
  return pending
}

/** Shared boot/My Pass full identity read. Holder discovery stays cached, but it is background work for My Pass. */
export function readPassIdentity(owner: Address, force = false): Promise<PassIdentityData> {
  const cacheKey = key(owner)
  const existing = cache.get(cacheKey)
  if (!force && existing?.value && Date.now() - existing.fetchedAt < FRESH_MS) {
    return Promise.resolve(existing.value)
  }
  if (existing?.promise) return existing.promise

  const entry: Entry<PassIdentityData> = existing ?? { fetchedAt: 0 }
  const pending = (async () => {
    const core = await readPassCoreIdentity(owner, force)
    if (!publicClient || !core.collection) return { ...core, holderIds: [] }
    const holderIds = await resolveHolderIds(publicClient, core.collection, owner)
    return { ...core, holderIds }
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
  if (!owner) {
    cache.clear()
    coreCache.clear()
  } else {
    cache.delete(key(owner))
    coreCache.delete(key(owner))
  }
}

export function __resetPassIdentityForTests() {
  cache.clear()
  coreCache.clear()
}
