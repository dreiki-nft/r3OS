import { zeroAddress, type Address } from 'viem'
import { getBlockSnapshot } from '../chain/blocks'
import { publicClient } from '../chain/clients'
import { config, deploymentScope } from '../chain/config'
import { readMany, type ReadManyResult } from '../chain/readMany'
import { idbGet, idbSet } from '../lib/idb'
import { R3TARDS_PAINT_ABI } from '../lib/generated/abi'
import { getActivityFeedSnapshot, subscribeCanvasActivity, type CanvasActivity } from '../paint/canvasStore'

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
const ownerScanInflight = new Map<string, Promise<OwnerCache>>()
const ownershipHints = new Map<number, Address | null>()
const frameSeasonHints = new Map<number, number>()
const confirmedRegularFrames = new Map<number, number>()
const confirmedFinales = new Map<number, bigint>()
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
let lastIndexRefreshAt = 0
const INDEX_FRESH_MS = 8_000
let indexReconcileTimer: ReturnType<typeof setTimeout> | undefined

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
  return `${deploymentScope()}:${tokenId}`
}

function ownerKey(account: Address) {
  return `${deploymentScope()}:${account.toLowerCase()}`
}

function viewerPreferenceKey(name: 'hidden' | 'unhidden') {
  return `r3os.${name}:${deploymentScope()}`
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
    const value: unknown = JSON.parse(localStorage.getItem(viewerPreferenceKey('unhidden')) ?? '[]')
    if (!Array.isArray(value)) return new Set<number>()
    return new Set(value.filter((item): item is number => Number.isInteger(item) && item >= 0))
  } catch {
    return new Set<number>()
  }
}

function readHidden() {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(viewerPreferenceKey('hidden')) ?? '[]')
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

function handleCanvasActivity(activity: CanvasActivity) {
  if (activity.eventName === 'FrameMinted' || activity.eventName === 'SeasonFinaleMinted') {
    applyConfirmedFrameActivity(activity)
    scheduleIndexReconcile()
  }
  if (activity.eventName === 'Transfer') void applyTransfer(activity)
}

function ensureStarted() {
  if (started) return
  started = true
  void loadFlagged()
  subscribeCanvasActivity(handleCanvasActivity)
  // My Frames is lazy-loaded. Replay the recent receipt/websocket feed so a frame minted before the
  // program was opened is still indexed and attributed immediately instead of being lost to timing.
  for (const activity of getActivityFeedSnapshot().items) handleCanvasActivity(activity)
}

function trimHintMap<T>(map: Map<number, T>, max = 512) {
  while (map.size > max) {
    const first = map.keys().next().value as number | undefined
    if (first == null) break
    map.delete(first)
  }
}

function mergeConfirmedSeasonHints(seasons: readonly SeasonSummary[]) {
  const merged = seasons.map((row) => ({ ...row }))
  const maxSeason = Math.max(
    merged.length - 1,
    ...confirmedRegularFrames.keys(),
    ...confirmedFinales.keys(),
    0,
  )
  while (merged.length <= maxSeason) {
    const season = merged.length
    merged.push({ season, regularFrames: 0, finaleMinted: false, finaleTokenId: 0n, count: 0 })
  }
  for (const [season, regularFrames] of confirmedRegularFrames) {
    const row = merged[season]
    row.regularFrames = Math.max(row.regularFrames, regularFrames)
  }
  for (const [season, tokenId] of confirmedFinales) {
    const row = merged[season]
    row.finaleMinted = true
    row.finaleTokenId = tokenId
  }
  for (const row of merged) row.count = row.regularFrames + (row.finaleMinted ? 1 : 0)
  return merged
}

export function applyConfirmedFrameActivityToIndex(
  previous: Pick<FramesSnapshot, 'currentSeason' | 'seasons' | 'total'>,
  activity: Pick<CanvasActivity, 'eventName' | 'tokenId' | 'season' | 'seasonFrameIndex'>,
) {
  if (
    (activity.eventName !== 'FrameMinted' && activity.eventName !== 'SeasonFinaleMinted') ||
    activity.tokenId == null ||
    activity.season == null
  ) {
    return previous
  }
  const season = Number(activity.season)
  const seasons = previous.seasons.map((row) => ({ ...row }))
  while (seasons.length <= season) {
    const index = seasons.length
    seasons.push({ season: index, regularFrames: 0, finaleMinted: false, finaleTokenId: 0n, count: 0 })
  }
  const row = seasons[season]
  if (activity.eventName === 'FrameMinted') {
    const seasonFrameIndex = Number(activity.seasonFrameIndex ?? BigInt(row.regularFrames + 1))
    row.regularFrames = Math.max(row.regularFrames, seasonFrameIndex)
  } else {
    row.finaleMinted = true
    row.finaleTokenId = activity.tokenId
  }
  row.count = row.regularFrames + (row.finaleMinted ? 1 : 0)
  return {
    currentSeason: Math.max(previous.currentSeason, season),
    seasons,
    total: Math.max(previous.total, seasonTotal(seasons), Number(activity.tokenId)),
  }
}

function applyConfirmedFrameActivity(activity: CanvasActivity) {
  if (activity.tokenId == null || activity.season == null) return
  const tokenId = Number(activity.tokenId)
  const season = Number(activity.season)
  frameSeasonHints.set(tokenId, season)
  trimHintMap(frameSeasonHints)
  if (activity.eventName === 'FrameMinted') {
    confirmedRegularFrames.set(
      season,
      Math.max(confirmedRegularFrames.get(season) ?? 0, Number(activity.seasonFrameIndex ?? 0n)),
    )
  } else if (activity.eventName === 'SeasonFinaleMinted') {
    confirmedFinales.set(season, activity.tokenId)
  }
  const next = applyConfirmedFrameActivityToIndex(snapshot, activity)
  emit(next)
}

function scheduleIndexReconcile(delayMs = 1_200) {
  if (indexReconcileTimer) clearTimeout(indexReconcileTimer)
  indexReconcileTimer = setTimeout(() => {
    indexReconcileTimer = undefined
    void refreshFrameIndex(true).catch(() => undefined)
  }, delayMs)
}

export function frameSeasonHint(tokenId: number) {
  return frameSeasonHints.get(tokenId)
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

export function ownersFromReadMany(ids: readonly number[], results: readonly ReadManyResult[]) {
  const ownerById: Record<string, Address | null> = {}
  results.forEach((result, index) => {
    ownerById[String(ids[index])] = result.status === 'success' ? (result.result as Address) : null
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

export function seasonIndexChanged(
  previous: Pick<FramesSnapshot, 'currentSeason' | 'seasons' | 'total'>,
  currentSeason: number,
  seasons: readonly SeasonSummary[],
  total: number,
) {
  if (previous.currentSeason !== currentSeason || previous.total !== total) return true
  if (previous.seasons.length !== seasons.length) return true
  return seasons.some((row, index) => {
    const old = previous.seasons[index]
    return (
      old.season !== row.season ||
      old.regularFrames !== row.regularFrames ||
      old.finaleMinted !== row.finaleMinted ||
      old.finaleTokenId !== row.finaleTokenId
    )
  })
}

export async function refreshFrameIndex(force = false) {
  ensureStarted()
  if (!force && snapshot.seasons.length && Date.now() - lastIndexRefreshAt < INDEX_FRESH_MS) return
  // Never run overlapping index refreshes. Receipt-driven frame hints update the local index immediately,
  // and a delayed reconcile catches the authoritative chain view once every RPC has caught up.
  if (indexPromise) return indexPromise
  indexPromise = (async () => {
    if (!publicClient || !config.paintAddress) return
    // Only the first load shows a loading state; later refreshes emit only on real changes,
    // otherwise version-driven effects (My Frames loadMine) re-trigger this refresh forever.
    if (!snapshot.seasons.length) emit({ loading: true })
    const client = publicClient
    const currentSeason = Number(
      await client.readContract({
        address: config.paintAddress,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'currentSeason',
      }),
    )
    const values = (await readMany(
      Array.from({ length: currentSeason + 1 }, (_, season) => ({
        address: config.paintAddress!,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'seasonInfo',
        args: [BigInt(season)],
      })),
      { allowFailure: false },
    )) as readonly (readonly unknown[])[]
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
    const mergedSeasons = mergeConfirmedSeasonHints(seasons)
    const hintedMaxToken = Math.max(0, ...frameSeasonHints.keys())
    const total = Math.max(seasonTotal(mergedSeasons), hintedMaxToken)
    const mergedCurrentSeason = Math.max(currentSeason, mergedSeasons.length - 1)
    lastIndexRefreshAt = Date.now()
    if (!snapshot.loading && !seasonIndexChanged(snapshot, mergedCurrentSeason, mergedSeasons, total)) return
    emit({ loading: false, currentSeason: mergedCurrentSeason, seasons: mergedSeasons, total })
  })().finally(() => {
    indexPromise = undefined
  })
  return indexPromise
}

async function readFrameInfoFromChain(tokenId: number) {
  if (!publicClient || !config.paintAddress) return undefined
  const delays = frameSeasonHints.has(tokenId) ? [0, 250, 600, 1_000] : [0]
  let lastError: unknown
  for (const delay of delays) {
    if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay))
    try {
      const raw = await publicClient.readContract({
        address: config.paintAddress,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'frameInfo',
        args: [BigInt(tokenId)],
      })
      return toFrameInfo(raw)
    } catch (error) {
      lastError = error
    }
  }
  if (lastError) throw lastError
  return undefined
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
  const info = await readFrameInfoFromChain(tokenId)
  if (!info) return undefined
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
    const values = (await readMany(
      missing.map((tokenId) => ({
        address: config.paintAddress!,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'frameInfo',
        args: [BigInt(tokenId)],
      })),
      { allowFailure: true },
    )) as ReadManyResult[]
    await Promise.all(
      values.map(async (result, index) => {
        const tokenId = missing[index]
        let info: FrameInfo | undefined
        if (result.status === 'success') info = toFrameInfo(result.result)
        else info = await readFrameInfoFromChain(tokenId).catch(() => undefined)
        if (!info) return
        infoMemory.set(tokenId, info)
        frameSeasonHints.set(tokenId, info.season)
        trimHintMap(frameSeasonHints)
        out.set(tokenId, info)
        await idbSet('frameInfo', cacheKey(tokenId), info)
      }),
    )
  }
  return out
}

export async function seasonTokenIds(season: SeasonSummary) {
  if (!publicClient || !config.paintAddress) return []
  const regular = await readMany(
    Array.from({ length: season.regularFrames }, (_, index) => ({
      address: config.paintAddress!,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'seasonFrameToken',
      args: [BigInt(season.season), index + 1],
    })),
    { allowFailure: false },
  ) as bigint[]
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
  for (const [tokenId, owner] of ownershipHints) value.ownerById[String(tokenId)] = owner
  ownerCaches.set(key, value)
  return value
}

export async function scanOwners(account: Address, total = snapshot.total) {
  if (!publicClient || !config.paintAddress) return { ownerById: {}, scannedUpTo: 0, atBlock: '0' }
  const key = ownerKey(account)
  const active = ownerScanInflight.get(key)
  if (active) {
    const joined = await active
    if (joined.scannedUpTo >= total) return joined
  }

  const pending = (async () => {
    const cache = await loadOwnerCache(account)
    const client = publicClient
    const seenHead = getBlockSnapshot().block
    const atBlock = String(seenHead > 0n ? seenHead : await client.getBlockNumber({ cacheTime: 0 }))
    if (!Object.prototype.hasOwnProperty.call(cache.ownerById, '0')) {
      const zero = await client
        .readContract({
          address: config.paintAddress!,
          abi: R3TARDS_PAINT_ABI,
          functionName: 'ownerOf',
          args: [0n],
        })
        .catch(() => null)
      cache.ownerById['0'] = zero as Address | null
    }
    for (const ids of ownerScanBatches(cache.scannedUpTo + 1, total)) {
      const end = ids[ids.length - 1]
      const results = (await readMany(
        ids.map((tokenId) => ({
          address: config.paintAddress!,
          abi: R3TARDS_PAINT_ABI,
          functionName: 'ownerOf',
          args: [BigInt(tokenId)],
        })),
        { allowFailure: true },
      )) as ReadManyResult[]
      Object.assign(cache.ownerById, ownersFromReadMany(ids, results))
      cache.scannedUpTo = end
      cache.atBlock = atBlock
      for (const [tokenId, owner] of ownershipHints) cache.ownerById[String(tokenId)] = owner
      await idbSet('owners', key, cache)
    }
    for (const [tokenId, owner] of ownershipHints) cache.ownerById[String(tokenId)] = owner
    return cache
  })().finally(() => {
    if (ownerScanInflight.get(key) === pending) ownerScanInflight.delete(key)
  })
  ownerScanInflight.set(key, pending)
  return pending
}

async function applyTransfer(activity: CanvasActivity) {
  if (activity.tokenId == null) return
  const tokenId = activity.tokenId
  const tokenNumber = Number(tokenId)
  const to = activity.to as Address | undefined
  const owner = !to || to.toLowerCase() === zeroAddress ? null : to
  ownershipHints.set(tokenNumber, owner)
  trimHintMap(ownershipHints)
  await Promise.all(
    [...ownerCaches.entries()].map(async ([key, cache]) => {
      applyTransferToOwnerMap(cache.ownerById, tokenId, to)
      // Transfer events are exact ownership hints, but they are not a contiguous enumeration scan.
      // Never jump scannedUpTo over older ids just because we observed a high token id transfer.
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
    localStorage.setItem(
      viewerPreferenceKey('unhidden'),
      JSON.stringify([...unhidden].sort((a, b) => a - b)),
    )
    localStorage.setItem(
      viewerPreferenceKey('hidden'),
      JSON.stringify([...hidden].sort((a, b) => a - b)),
    )
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
    localStorage.setItem(
      viewerPreferenceKey('unhidden'),
      JSON.stringify([...unhidden].sort((a, b) => a - b)),
    )
    localStorage.setItem(
      viewerPreferenceKey('hidden'),
      JSON.stringify([...hidden].sort((a, b) => a - b)),
    )
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
  ownerScanInflight.clear()
  ownershipHints.clear()
  frameSeasonHints.clear()
  confirmedRegularFrames.clear()
  confirmedFinales.clear()
  if (indexReconcileTimer) clearTimeout(indexReconcileTimer)
  indexReconcileTimer = undefined
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
