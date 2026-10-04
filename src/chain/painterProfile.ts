import type { Address } from 'viem'
import { config } from './config'
import { readMany } from './readMany'
import { R3OS_PAINT_ABI } from '../lib/generated/abi'

export interface PainterProfile {
  stats: readonly bigint[]
  holder: boolean
}

type CacheEntry = {
  value?: PainterProfile
  fetchedAt: number
  promise?: Promise<PainterProfile>
}

const FRESH_MS = 8_000
const cache = new Map<string, CacheEntry>()

function key(owner: Address) {
  return `${config.chainId}:${config.paintAddress?.toLowerCase() ?? 'no-paint'}:${owner.toLowerCase()}`
}

/**
 * Shared short-lived painter profile read. Boot, My Pass and Live Mode all need painterStats;
 * making them join one promise prevents three identical startup multicalls.
 */
export function readPainterProfile(owner: Address, force = false): Promise<PainterProfile> {
  if (!config.paintAddress) return Promise.resolve({ stats: [], holder: false })
  const cacheKey = key(owner)
  const existing = cache.get(cacheKey)
  const now = Date.now()
  if (!force && existing?.value && now - existing.fetchedAt < FRESH_MS) {
    return Promise.resolve(existing.value)
  }
  if (existing?.promise) return existing.promise

  const entry: CacheEntry = existing ?? { fetchedAt: 0 }
  const pending = readMany(
    [
      {
        address: config.paintAddress,
        abi: R3OS_PAINT_ABI,
        functionName: 'painterStats',
        args: [owner],
      },
      {
        address: config.paintAddress,
        abi: R3OS_PAINT_ABI,
        functionName: 'isR3tardHolder',
        args: [owner],
      },
    ],
    { allowFailure: false },
  )
    .then((rows) => {
      const value: PainterProfile = {
        stats: rows[0] as readonly bigint[],
        holder: Boolean(rows[1]),
      }
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

export function peekPainterProfile(owner: Address) {
  return cache.get(key(owner))?.value
}

export function invalidatePainterProfile(owner?: Address) {
  if (!owner) {
    cache.clear()
    return
  }
  cache.delete(key(owner))
}

export function __resetPainterProfileForTests() {
  cache.clear()
}
