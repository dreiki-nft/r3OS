import { zeroAddress, type Address } from 'viem'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { idbGet, idbSet } from '../lib/idb'
import { R3TARDS_PAINT_ABI } from '../lib/generated/abi'
import { subscribeCanvasActivity, type CanvasActivity } from '../paint/canvasStore'

export interface FrameInfo {
  minter: Address
  proposer: Address
  dataPointer: Address
  blockNumber: bigint
  season: number
  seasonFrameIndex: bigint
  frameNumber: bigint
  paintsSincePreviousFrame: bigint
  df1Amount: number
  faceColor: number
  backgroundColor: number
  holderAtMint: boolean
  finale: boolean
}

export interface SeasonSummary {
  season: number
  regularFrames: number
  finaleMinted: boolean
  finaleTokenId: bigint
  count: number
}

export interface FramesSnapshot {
  version: number
  loading: boolean
  total: number
  currentSeason: number
  seasons: readonly SeasonSummary[]
  flagged: ReadonlySet<number>
  unhidden: ReadonlySet<number>
  hidden: ReadonlySet<number>
}

interface OwnerCache {
  ownerById: Record<string, Address | null>
  scannedUpTo: number
  atBlock: string
}

type Listener = () => void
const listeners = new Set<Listener>()
const infoMemory = new Map<number, FrameInfo>()
const ownerCaches = new Map<string, OwnerCache>()
let snapshot: FramesSnapshot = {
  version: 0,
  loading: false,
  total: 0,
  currentSeason: 0,
  seasons: [],
  flagged: new Set(),
  unhidden: new Set(),
  hidden: new Set(),
}
let started = false
let flaggedPromise: Promise<void> | undefined
let indexPromise: Promise<void> | undefined

function emit(patch: Partial<FramesSnapshot>) {
  snapshot = { ...snapshot, ...patch, version: snapshot.version + 1 }
  for (const listener of listeners) listener()
}

export function subscribeFrames(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getFramesSnapshot() {
  return snapshot
}

function cacheKey(tokenId: number) {
  return `${config.chainId}:${tokenId}`
}

function ownerKey(account: Address) {
  return `${config.chainId}:${account.toLowerCase()}`
}

function toFrameInfo(value: unknown): FrameInfo {
  const item = value as {
    minter: Address
    proposer: Address
    dataPointer: Address
    blockNumber: bigint
    season: number | bigint
    seasonFrameIndex: bigint
    frameNumber: bigint
    paintsSincePreviousFrame: bigint
    df1Amount: number | bigint
    faceColor: number | bigint
    backgroundColor: number | bigint
    holderAtMint: boolean
    finale: boolean
  }
  return {
    minter: item.minter,
    proposer: item.proposer,
    dataPointer: item.dataPointer,
    blockNumber: item.blockNumber,
    season: Number(item.season),
    seasonFrameIndex: item.seasonFrameIndex,
    frameNumber: item.frameNumber,
    paintsSincePreviousFrame: item.paintsSincePreviousFrame,
    df1Amount: Number(item.df1Amount),
    faceColor: Number(item.faceColor),
    backgroundColor: Number(item.backgroundColor),
    holderAtMint: item.holderAtMint,
    finale: item.finale,
  }
}

function readUnhidden() {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('r3os.unhidden') ?? '[]')
    if (!Array.isArray(value)) return new Set<number>()
    return new Set(value.filter((item): item is number => Number.isInteger(item) && item >= 0))
  } catch {
    return new Set<number>()
  }
}

function readHidden() {
  try {
    const value: unknown = JSON.parse(localStorage.getItem('r3os.hidden') ?? '[]')
    if (!Array.isArray(value)) return new Set<number>()
    return new Set(value.filter((item): item is number => Number.isInteger(item) && item > 0))
  } catch {
    return new Set<number>()
  }
}

async function loadFlagged() {
  if (flaggedPromise) return flaggedPromise
  flaggedPromise = (async () => {
    let flagged = new Set<number>()
    try {
      const response = await fetch('/flagged-frames.json')
      const json = (await response.json()) as { version?: number; flagged?: unknown[] }
      if (json.version === 1 && Array.isArray(json.flagged)) {
        flagged = new Set(
          json.flagged.filter((item): item is number => Number.isInteger(item) && Number(item) > 0),
        )
      }
    } catch {
      // Missing moderation data means no locally hidden frames.
    }
    emit({ flagged, unhidden: readUnhidden(), hidden: readHidden() })
  })()
  return flaggedPromise
}

function ensureStarted() {
  if (started) return
  started = true
  void loadFlagged()
  subscribeCanvasActivity((activity) => {
    if (activity.eventName === 'FrameMinted' || activity.eventName === 'SeasonFinaleMinted') {
      void refreshFrameIndex(true)
    }
    if (activity.eventName === 'Transfer') void applyTransfer(activity)
  })
}

export function seasonTotal(seasons: readonly Pick<SeasonSummary, 'regularFrames' | 'finaleMinted'>[]) {
  return seasons.reduce((sum, season) => sum + season.regularFrames + (season.finaleMinted ? 1 : 0), 0)
}

export function ownerScanBatches(from: number, total: number, size = 100) {
  const batches: number[][] = []
  for (let start = from; start <= total; start += size) {
    const end = Math.min(total, start + size - 1)
    batches.push(Array.from({ length: end - start + 1 }, (_, index) => start + index))
  }
  return batches
}

export function ownersFromSettled(ids: readonly number[], results: readonly PromiseSettledResult<unknown>[]) {
  const ownerById: Record<string, Address | null> = {}
  results.forEach((result, index) => {
    ownerById[String(ids[index])] = result.status === 'fulfilled' ? (result.value as Address) : null
  })
  return ownerById
}

export function applyTransferToOwnerMap(
  ownerById: Record<string, Address | null>,
  tokenId: bigint,
  to?: Address,
) {
  ownerById[tokenId.toString()] = !to || to.toLowerCase() === zeroAddress ? null : to
}

export function visibleFlaggedIds(flagged: Iterable<number>, unhidden: Iterable<number>) {
  const restored = new Set(unhidden)
  return [...flagged].filter((id) => !restored.has(id)).sort((a, b) => b - a)
}

export async function refreshFrameIndex(force = false) {
  ensureStarted()
  if (indexPromise && !force) return indexPromise
  indexPromise = (async () => {
    if (!publicClient || !config.paintAddress) return
    emit({ loading: true })
    const client = publicClient
    const currentSeason = Number(
      await client.readContract({
        address: config.paintAddress,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'currentSeason',
      }),
    )
    const values = await Promise.all(
      Array.from(
        { length: currentSeason + 1 },
        (_, season) =>
          client.readContract({
            address: config.paintAddress!,
            abi: R3TARDS_PAINT_ABI,
            functionName: 'seasonInfo',
            args: [BigInt(season)],
          }) as Promise<readonly unknown[]>,
      ),
    )
    const seasons = values.map((value, season): SeasonSummary => {
      const regularFrames = Number(value[4])
      const finaleMinted = Boolean(value[5])
      return {
        season,
        regularFrames,
        finaleMinted,
        finaleTokenId: BigInt(value[6] as bigint),
        count: regularFrames + (finaleMinted ? 1 : 0),
      }
    })
    const total = seasonTotal(seasons)
    emit({ loading: false, currentSeason, seasons, total })
  })().finally(() => {
    indexPromise = undefined
  })
  return indexPromise
}

export async function getFrameInfo(tokenId: number) {
  if (tokenId === 0) return undefined
  const memory = infoMemory.get(tokenId)
  if (memory) return memory
  const cached = await idbGet<FrameInfo>('frameInfo', cacheKey(tokenId))
  if (cached) {
    infoMemory.set(tokenId, cached)
    return cached
  }
  if (!publicClient || !config.paintAddress) return undefined
  const raw = await publicClient.readContract({
    address: config.paintAddress,
    abi: R3TARDS_PAINT_ABI,
    functionName: 'frameInfo',
    args: [BigInt(tokenId)],
  })
  const info = toFrameInfo(raw)
  infoMemory.set(tokenId, info)
  await idbSet('frameInfo', cacheKey(tokenId), info)
  return info
}

export async function getFrameInfoBatch(tokenIds: readonly number[]) {
  const out = new Map<number, FrameInfo>()
  const missing: number[] = []
  await Promise.all(
    [...new Set(tokenIds.filter((id) => id > 0))].map(async (tokenId) => {
      const memory = infoMemory.get(tokenId)
      if (memory) {
        out.set(tokenId, memory)
        return
      }
      const cached = await idbGet<FrameInfo>('frameInfo', cacheKey(tokenId))
      if (cached) {
        infoMemory.set(tokenId, cached)
        out.set(tokenId, cached)
      } else {
        missing.push(tokenId)
      }
    }),
  )
  if (missing.length && publicClient && config.paintAddress) {
    const client = publicClient
    const values = await Promise.all(
      missing.map((tokenId) =>
        client.readContract({
          address: config.paintAddress!,
          abi: R3TARDS_PAINT_ABI,
          functionName: 'frameInfo',
          args: [BigInt(tokenId)],
        }),
      ),
    )
    await Promise.all(
      values.map(async (raw, index) => {
        const tokenId = missing[index]
        const info = toFrameInfo(raw)
        infoMemory.set(tokenId, info)
        out.set(tokenId, info)
        await idbSet('frameInfo', cacheKey(tokenId), info)
      }),
    )
  }
  return out
}

export async function seasonTokenIds(season: SeasonSummary) {
  if (!publicClient || !config.paintAddress) return []
  const client = publicClient
  const regular = await Promise.all(
    Array.from(
      { length: season.regularFrames },
      (_, index) =>
        client.readContract({
          address: config.paintAddress!,
          abi: R3TARDS_PAINT_ABI,
          functionName: 'seasonFrameToken',
          args: [BigInt(season.season), index + 1],
        }) as Promise<bigint>,
    ),
  )
  const ids = regular.map(Number).filter((id) => id > 0)
  if (season.finaleMinted && season.finaleTokenId > 0n) ids.push(Number(season.finaleTokenId))
  return ids.sort((a, b) => b - a)
}

async function loadOwnerCache(account: Address) {
  const key = ownerKey(account)
  const memory = ownerCaches.get(key)
  if (memory) return memory
  const cached = await idbGet<OwnerCache>('owners', key)
  const value = cached ?? { ownerById: {}, scannedUpTo: 0, atBlock: '0' }
  ownerCaches.set(key, value)
  return value
}

export async function scanOwners(account: Address, total = snapshot.total) {
  if (!publicClient || !config.paintAddress) return { ownerById: {}, scannedUpTo: 0, atBlock: '0' }
  const cache = await loadOwnerCache(account)
  const client = publicClient
  const atBlock = String(await client.getBlockNumber({ cacheTime: 0 }))
  if (!Object.prototype.hasOwnProperty.call(cache.ownerById, '0')) {
    const zero = await client
      .readContract({
        address: config.paintAddress,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'ownerOf',
        args: [0n],
      })
      .catch(() => null)
    cache.ownerById['0'] = zero as Address | null
  }
  for (const ids of ownerScanBatches(cache.scannedUpTo + 1, total)) {
    const end = ids[ids.length - 1]
    const results = await Promise.allSettled(
      ids.map((tokenId) =>
        client.readContract({
          address: config.paintAddress!,
          abi: R3TARDS_PAINT_ABI,
          functionName: 'ownerOf',
          args: [BigInt(tokenId)],
        }),
      ),
    )
    Object.assign(cache.ownerById, ownersFromSettled(ids, results))
    cache.scannedUpTo = end
    cache.atBlock = atBlock
    await idbSet('owners', ownerKey(account), cache)
  }
  return cache
}

async function applyTransfer(activity: CanvasActivity) {
  if (activity.tokenId == null) return
  const tokenId = activity.tokenId
  await Promise.all(
    [...ownerCaches.entries()].map(async ([key, cache]) => {
      applyTransferToOwnerMap(cache.ownerById, tokenId, activity.to as Address | undefined)
      if (tokenId > 0n) cache.scannedUpTo = Math.max(cache.scannedUpTo, Number(tokenId))
      cache.atBlock = activity.blockNumber.toString()
      await idbSet('owners', key, cache)
    }),
  )
  emit({})
}

export async function mineTokenIds(account: Address) {
  await refreshFrameIndex()
  const cache = await scanOwners(account)
  const mine = Object.entries(cache.ownerById)
    .filter(([, owner]) => owner?.toLowerCase() === account.toLowerCase())
    .map(([tokenId]) => Number(tokenId))
    .filter((tokenId) => tokenId === 0 || !isFrameHidden(tokenId))
    .sort((a, b) => (a === 0 ? -1 : b === 0 ? 1 : b - a))
  return mine
}

export async function ownerOfCached(account: Address, tokenId: number) {
  const cache = await scanOwners(account)
  return cache.ownerById[String(tokenId)] ?? null
}

export function isFrameHidden(tokenId: number) {
  return snapshot.hidden.has(tokenId) || (snapshot.flagged.has(tokenId) && !snapshot.unhidden.has(tokenId))
}

export function restoreFrame(tokenId: number) {
  const unhidden = new Set(snapshot.unhidden)
  const hidden = new Set(snapshot.hidden)
  unhidden.add(tokenId)
  hidden.delete(tokenId)
  try {
    localStorage.setItem('r3os.unhidden', JSON.stringify([...unhidden].sort((a, b) => a - b)))
    localStorage.setItem('r3os.hidden', JSON.stringify([...hidden].sort((a, b) => a - b)))
  } catch {
    // Viewer preference is optional.
  }
  emit({ unhidden, hidden })
}

export function hideFrame(tokenId: number) {
  if (tokenId <= 0) return
  const unhidden = new Set(snapshot.unhidden)
  const hidden = new Set(snapshot.hidden)
  unhidden.delete(tokenId)
  hidden.add(tokenId)
  try {
    localStorage.setItem('r3os.unhidden', JSON.stringify([...unhidden].sort((a, b) => a - b)))
    localStorage.setItem('r3os.hidden', JSON.stringify([...hidden].sort((a, b) => a - b)))
  } catch {
    // Viewer preference is optional.
  }
  emit({ unhidden, hidden })
}

export function hiddenFrameIds() {
  return [...new Set([...visibleFlaggedIds(snapshot.flagged, snapshot.unhidden), ...snapshot.hidden])].sort(
    (a, b) => b - a,
  )
}

export function pageNewestFirst(ids: readonly number[], page: number, pageSize = 24) {
  return [...ids].sort((a, b) => b - a).slice(0, Math.max(1, page) * pageSize)
}

export function finaleIds() {
  return snapshot.seasons
    .filter((season) => season.finaleMinted && season.finaleTokenId > 0n)
    .map((season) => Number(season.finaleTokenId))
    .filter((id) => !isFrameHidden(id))
    .sort((a, b) => b - a)
}

export function seasonSummary(season: number) {
  return snapshot.seasons.find((item) => item.season === season)
}

export function __resetFramesStoreForTests() {
  infoMemory.clear()
  ownerCaches.clear()
  snapshot = {
    version: 0,
    loading: false,
    total: 0,
    currentSeason: 0,
    seasons: [],
    flagged: new Set(),
    unhidden: new Set(),
    hidden: new Set(),
  }
  flaggedPromise = undefined
  indexPromise = undefined
  started = false
}
