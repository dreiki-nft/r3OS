import { hexToBytes, type Hex, type Log } from 'viem'
import { markTraceProposedFromPlainLog } from '../chain/txTrace'
import { publicClient, wsClient } from '../chain/clients'
import { readMany } from '../chain/readMany'
import { config } from '../chain/config'
import { getLogsWindow } from '../chain/logs'
export { chunkBlockRanges } from '../chain/logs'
import { decodeCoreEventLog } from '../chain/coreLogs'
import { demoConstants, readCoreConstants, seasonAtTimestamp } from '../chain/contracts'
import { R3TARDS_PAINT_ABI } from '../lib/generated/abi'
import { OUTLINE_MASK } from '../lib/layers'
import { decodePackedCanvas } from '../lib/patch'
import { applyPainted, expandOutlineRuns } from './replay'
import type { TilePreviewState } from './cost'

export interface CanvasSnapshot {
  background: Uint8Array
  working: Uint8Array
  outline: Uint8Array
  season: bigint
  face: number
  backgroundColor: number
  snapshotBlock: bigint
  status: 'demo' | 'live' | 'polling' | 'offline'
}

export interface TileCacheEntry {
  state: TilePreviewState
  block: bigint
  stale: boolean
}

export interface TileCacheSnapshot {
  version: number
  map: ReadonlyMap<number, TileCacheEntry>
}

export interface CanvasActivity {
  eventName: string
  owner?: string
  minter?: string
  from?: string
  to?: string
  sessionKey?: string
  tokenId?: bigint
  rendererId?: bigint
  transactionHash?: Hex
  blockNumber: bigint
  logIndex?: number | null
  runs?: Hex
  regionsMask?: number
}

export interface ActivityFeedSnapshot {
  version: number
  items: readonly CanvasActivity[]
}

type CoreLog = {
  blockNumber: bigint
  logIndex?: number | null
  transactionHash?: Hex | null
  data: Hex
  topics: readonly Hex[]
}

const blank = () => new Uint8Array(65_536)
let snapshot: CanvasSnapshot = {
  background: blank(),
  working: blank(),
  outline: OUTLINE_MASK.slice(),
  season: 0n,
  face: 1,
  backgroundColor: 0,
  snapshotBlock: 0n,
  status: config.demo ? 'demo' : 'offline',
}
const canvasListeners = new Set<() => void>()
const activityListeners = new Set<(activity: CanvasActivity) => void>()
const activityFeedListeners = new Set<() => void>()
const tileListeners = new Set<() => void>()
const tileCache = new Map<number, TileCacheEntry>()
let tileSnapshot: TileCacheSnapshot = { version: 0, map: tileCache }
let unwatch: (() => void) | undefined
let pollTimer: number | undefined
let reconcileTimer: number | undefined
let serial = Promise.resolve()
let started = false
let constants = demoConstants
let activityFeed: ActivityFeedSnapshot = { version: 0, items: [] }
const appliedLogKeys = new Map<string, bigint>()

function emitCanvas() {
  for (const listener of canvasListeners) listener()
}

function emitTiles() {
  tileSnapshot = { version: tileSnapshot.version + 1, map: tileCache }
  for (const listener of tileListeners) listener()
}

function emitActivity(activity: CanvasActivity) {
  activityFeed = {
    version: activityFeed.version + 1,
    items: [...activityFeed.items, activity].slice(-600),
  }
  for (const listener of activityListeners) listener(activity)
  for (const listener of activityFeedListeners) listener()
}

export function getCanvasSnapshot() {
  return snapshot
}

export function subscribeCanvas(listener: () => void) {
  canvasListeners.add(listener)
  return () => {
    canvasListeners.delete(listener)
  }
}

export function subscribeCanvasActivity(listener: (activity: CanvasActivity) => void) {
  activityListeners.add(listener)
  return () => {
    activityListeners.delete(listener)
  }
}

export function getActivityFeedSnapshot() {
  return activityFeed
}

export function subscribeActivityFeed(listener: () => void) {
  activityFeedListeners.add(listener)
  return () => {
    activityFeedListeners.delete(listener)
  }
}

export function getTileCacheSnapshot() {
  return tileSnapshot
}

export function subscribeTileCache(listener: () => void) {
  tileListeners.add(listener)
  return () => {
    tileListeners.delete(listener)
  }
}

function preservePending(nextBase: Uint8Array) {
  const next = nextBase.slice()
  for (let index = 0; index < next.length; index++) {
    if (snapshot.working[index] !== snapshot.background[index]) next[index] = snapshot.working[index]
  }
  return next
}

export function setWorking(next: Uint8Array) {
  snapshot = { ...snapshot, working: next }
  emitCanvas()
}

export function clearPending() {
  snapshot = { ...snapshot, working: snapshot.background.slice() }
  emitCanvas()
}

export function createSerialQueue() {
  let queue = Promise.resolve()
  return <T>(job: () => Promise<T>) => {
    const run = queue.then(job, job)
    queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

function enqueue<T>(job: () => Promise<T>) {
  const run = serial.then(job, job)
  serial = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function sortLogs<T extends { blockNumber: bigint; logIndex?: number | null }>(logs: readonly T[]) {
  return [...logs].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1
    return Number(a.logIndex ?? 0) - Number(b.logIndex ?? 0)
  })
}

export function tilesTouchedByPainted(runs: Uint8Array, corruptions: Uint8Array) {
  const touched = new Set<number>()
  for (let offset = 0; offset + 3 < runs.length; offset += 4) {
    const y = runs[offset]
    for (let x = runs[offset + 1]; x <= runs[offset + 2]; x++) touched.add((y >> 4) * 16 + (x >> 4))
  }
  for (let offset = 0; offset + 2 < corruptions.length; offset += 3) {
    const x = corruptions[offset]
    const y = corruptions[offset + 1]
    touched.add((y >> 4) * 16 + (x >> 4))
  }
  return touched
}

export function markTilesStale(tiles: Iterable<number>) {
  let changed = false
  for (const tile of tiles) {
    const entry = tileCache.get(tile)
    if (entry && !entry.stale) {
      tileCache.set(tile, { ...entry, stale: true })
      changed = true
    }
  }
  if (changed) emitTiles()
}

function decodeCoreLog(log: CoreLog) {
  try {
    return decodeCoreEventLog(log)
  } catch {
    return undefined
  }
}

function outlineChange(eventName: string) {
  return (
    eventName === 'SeasonOutlineSet' ||
    eventName === 'SeasonOutlineAppended' ||
    eventName === 'SeasonOutlineCleared' ||
    eventName === 'SeasonFinaleMinted'
  )
}

function coreLogKey(log: Pick<CoreLog, 'transactionHash' | 'logIndex'>) {
  if (!log.transactionHash || log.logIndex == null) return undefined
  return `${log.transactionHash.toLowerCase()}:${log.logIndex}`
}

function rememberLog(log: CoreLog) {
  const key = coreLogKey(log)
  if (key) appliedLogKeys.set(key, log.blockNumber)
  if (log.transactionHash) markTraceProposedFromPlainLog(log.transactionHash, log.blockNumber)
}

export function logSetsDiffer(applied: Iterable<string>, canonical: Iterable<string>) {
  const left = new Set(applied)
  const right = new Set(canonical)
  if (left.size !== right.size) return true
  for (const key of left) if (!right.has(key)) return true
  return false
}

export async function reloadOnSpeculativeMismatch(
  applied: Iterable<string>,
  canonical: Iterable<string>,
  reload: () => Promise<void>,
) {
  if (!logSetsDiffer(applied, canonical)) return false
  await reload()
  return true
}

function pruneApplied(beforeBlock: bigint) {
  for (const [key, block] of appliedLogKeys) if (block < beforeBlock) appliedLogKeys.delete(key)
}

async function seedCanonicalOverlap(latest: bigint) {
  if (!publicClient || !config.paintAddress) return
  const fromBlock = latest > 32n ? latest - 32n : 0n
  const logs = (await getLogsWindow({
    address: config.paintAddress,
    fromBlock,
    toBlock: latest,
    maxBlocks: 33,
  })) as unknown as CoreLog[]
  pruneApplied(fromBlock)
  for (const log of logs) {
    const key = coreLogKey(log)
    if (key) appliedLogKeys.set(key, log.blockNumber)
  }
}

async function applyDeliveredLogs(
  logs: readonly CoreLog[],
  options: { advanceSnapshot?: boolean } = {},
) {
  if (!logs.length) return false
  const advanceSnapshot = options.advanceSnapshot ?? true
  let needsReload = false
  for (const log of sortLogs(logs)) {
    const key = coreLogKey(log)
    if (key && appliedLogKeys.has(key)) continue
    rememberLog(log)
    const decoded = decodeCoreLog(log)
    if (!decoded) continue
    const eventName = decoded.eventName
    const args = decoded.args as Record<string, unknown>
    const common = {
      eventName,
      blockNumber: log.blockNumber,
      logIndex: log.logIndex,
      transactionHash: log.transactionHash ?? undefined,
    }
    if (outlineChange(eventName)) needsReload = true
    if (eventName === 'Painted') {
      const season = BigInt(args.season as bigint)
      if (season !== snapshot.season) {
        needsReload = true
      } else {
        const runsBytes = hexToBytes(args.runs as Hex)
        const corruptions = hexToBytes(args.corruptions as Hex)
        const background = applyPainted(snapshot.background, snapshot.outline, runsBytes, corruptions)
        snapshot = { ...snapshot, background, working: preservePending(background) }
        markTilesStale(tilesTouchedByPainted(runsBytes, corruptions))
      }
      const owner = String(args.owner ?? '')
      const sender = String(args.sender ?? '')
      emitActivity({
        ...common,
        owner,
        ...(sender && sender.toLowerCase() !== owner.toLowerCase() ? { sessionKey: sender } : {}),
        runs: args.runs as Hex,
        regionsMask: Number(args.regionsMask ?? 0),
      })
    } else if (eventName === 'FaceChanged') {
      snapshot = { ...snapshot, face: Number(args.color) }
      emitActivity({ ...common, owner: String(args.owner ?? '') })
    } else if (eventName === 'BackgroundChanged') {
      snapshot = { ...snapshot, backgroundColor: Number(args.color) }
      emitActivity({ ...common, owner: String(args.owner ?? '') })
    } else if (eventName === 'FrameMinted') {
      emitActivity({
        ...common,
        minter: String(args.minter ?? ''),
        tokenId: BigInt(args.frameId as bigint),
      })
    } else if (eventName === 'SeasonFinaleMinted') {
      emitActivity({
        ...common,
        minter: String(args.recipient ?? ''),
        tokenId: BigInt(args.tokenId as bigint),
      })
    } else if (eventName === 'Transfer') {
      emitActivity({
        ...common,
        from: String(args.from ?? ''),
        to: String(args.to ?? ''),
        tokenId: BigInt(args.tokenId as bigint),
      })
    } else if (eventName === 'TokenRendererSet') {
      emitActivity({
        ...common,
        tokenId: BigInt(args.tokenId as bigint),
        rendererId: BigInt(args.rendererId as bigint),
      })
    } else if (eventName === 'SessionStarted' || eventName === 'SessionRevoked') {
      emitActivity({
        ...common,
        owner: String(args.owner ?? ''),
        sessionKey: String(args.sessionKey ?? ''),
      })
    } else if (!outlineChange(eventName)) {
      emitActivity(common)
    }
    if (advanceSnapshot && log.blockNumber > snapshot.snapshotBlock) {
      snapshot = { ...snapshot, snapshotBlock: log.blockNumber }
    }
  }
  emitCanvas()
  return needsReload
}

export async function loadCanvasNow() {
  if (!publicClient || !config.paintAddress) {
    emitCanvas()
    return
  }
  const block = await publicClient.getBlockNumber({ cacheTime: 0 })
  const season = (await publicClient.readContract({
    address: config.paintAddress,
    abi: R3TARDS_PAINT_ABI,
    functionName: 'currentSeason',
    blockNumber: block,
  })) as bigint
  const [packed, info, custom] = await Promise.all([
    publicClient.readContract({
      address: config.paintAddress,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'getBackgroundCanvas',
      blockNumber: block,
    }) as Promise<Hex>,
    publicClient.readContract({
      address: config.paintAddress,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'seasonInfo',
      args: [season],
      blockNumber: block,
    }) as Promise<readonly unknown[]>,
    publicClient.readContract({
      address: config.paintAddress,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'hasCustomOutline',
      args: [season],
      blockNumber: block,
    }) as Promise<boolean>,
  ])
  let outline = OUTLINE_MASK.slice()
  if (custom) {
    const runs = (await publicClient.readContract({
      address: config.paintAddress,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'seasonOutlineRuns',
      args: [season],
      blockNumber: block,
    })) as Hex
    outline = expandOutlineRuns(new Uint8Array(hexToBytes(runs)))
  }
  const background = decodePackedCanvas(packed)
  if (import.meta.env.DEV && snapshot.snapshotBlock !== 0n && snapshot.season === season) {
    for (let index = 0; index < background.length; index++) {
      if (background[index] !== snapshot.background[index]) {
        console.warn('canvas replay mismatch at pixel', index, snapshot.background[index], background[index])
        break
      }
    }
  }
  snapshot = {
    background,
    working: preservePending(background),
    outline,
    season,
    face: Number(info[2]),
    backgroundColor: Number(info[3]),
    snapshotBlock: block,
    status: wsClient ? 'live' : 'polling',
  }
  tileCache.clear()
  appliedLogKeys.clear()
  await seedCanonicalOverlap(block)
  emitTiles()
  emitCanvas()
}

export function loadCanvas() {
  return enqueue(loadCanvasNow)
}

function estimatedSeasonNow() {
  const unix = BigInt(Math.floor(Date.now() / 1_000))
  return seasonAtTimestamp(unix, constants)
}

export async function catchUpNow(targetBlock?: bigint) {
  if (!publicClient || !config.paintAddress) return
  const latest = targetBlock ?? (await publicClient.getBlockNumber({ cacheTime: 0 }))
  if (estimatedSeasonNow() !== snapshot.season) {
    await loadCanvasNow()
    return
  }
  if (latest <= snapshot.snapshotBlock) return
  const gap = latest - snapshot.snapshotBlock
  if (gap > BigInt(20 * config.logsRange)) {
    await loadCanvasNow()
    return
  }
  let needsReload = false
  const logs = (await getLogsWindow({
    address: config.paintAddress,
    fromBlock: snapshot.snapshotBlock + 1n,
    toBlock: latest,
  })) as unknown as CoreLog[]
  if (await applyDeliveredLogs(logs)) needsReload = true
  if (needsReload) {
    await loadCanvasNow()
    return
  }
  if (latest > snapshot.snapshotBlock) {
    snapshot = { ...snapshot, snapshotBlock: latest }
    emitCanvas()
  }
}

export function catchUp(targetBlock?: bigint) {
  return enqueue(() => catchUpNow(targetBlock))
}

async function onSubscriptionLogs(logs: readonly unknown[]) {
  const typed = logs as CoreLog[]
  const needsReload = await applyDeliveredLogs(typed)
  if (needsReload) await loadCanvas()
}

export async function reconcileSpeculativeNow() {
  if (!publicClient || !config.paintAddress) return false
  const latest = await publicClient.getBlockNumber({ cacheTime: 0 })
  const fromBlock = snapshot.snapshotBlock > 32n ? snapshot.snapshotBlock - 32n : 0n
  if (latest - fromBlock + 1n > BigInt(20 * config.logsRange)) {
    await loadCanvasNow()
    return true
  }
  const logs = (await getLogsWindow({
    address: config.paintAddress,
    fromBlock,
    toBlock: latest,
  })) as unknown as CoreLog[]
  const canonical = logs.map(coreLogKey).filter((key): key is string => Boolean(key))
  const applied = [...appliedLogKeys.entries()]
    .filter(([, block]) => block >= fromBlock && block <= latest)
    .map(([key]) => key)
  if (await reloadOnSpeculativeMismatch(applied, canonical, loadCanvasNow)) {
    return true
  }
  if (latest > snapshot.snapshotBlock) {
    snapshot = { ...snapshot, snapshotBlock: latest }
    emitCanvas()
  }
  pruneApplied(fromBlock)
  return false
}

export async function startCanvasStore() {
  if (started) return
  started = true
  constants = await readCoreConstants().catch(() => demoConstants)
  await loadCanvas()
  if (wsClient && config.paintAddress) {
    unwatch = wsClient.watchContractEvent({
      address: config.paintAddress,
      abi: R3TARDS_PAINT_ABI,
      onLogs: (logs) => void onSubscriptionLogs(logs),
      onError: () => {
        void catchUp().finally(startPolling)
      },
    })
  } else {
    startPolling()
  }
  reconcileTimer = window.setInterval(() => void reconcileSpeculativeNow(), 30_000)
}

function startPolling() {
  unwatch?.()
  unwatch = undefined
  const tick = async () => {
    if (!document.hidden) await catchUp()
    pollTimer = window.setTimeout(tick, document.hidden ? 5_000 : 1_000)
  }
  if (pollTimer) window.clearTimeout(pollTimer)
  void tick()
}

export function stopCanvasStore() {
  unwatch?.()
  if (pollTimer) window.clearTimeout(pollTimer)
  if (reconcileTimer) window.clearInterval(reconcileTimer)
  started = false
}

export function beginInFlight(runs: Uint8Array) {
  const sent = new Map<number, number>()
  for (let offset = 0; offset + 3 < runs.length; offset += 4) {
    const y = runs[offset]
    const colour = runs[offset + 3]
    for (let x = runs[offset + 1]; x <= runs[offset + 2]; x++) sent.set(y * 256 + x, colour)
  }
  return sent
}

export function clearMatchingInFlight(
  working: Uint8Array,
  background: Uint8Array,
  sent: ReadonlyMap<number, number>,
) {
  const next = working.slice()
  for (const [index, colour] of sent) {
    if (next[index] === colour) next[index] = background[index]
  }
  return next
}

export async function settleInFlight(sent: ReadonlyMap<number, number>, receiptBlock: bigint) {
  await catchUp(receiptBlock)
  if (snapshot.snapshotBlock < receiptBlock) await catchUp()
  snapshot = {
    ...snapshot,
    working: clearMatchingInFlight(snapshot.working, snapshot.background, sent),
  }
  emitCanvas()
}

/**
 * Fast path for our own confirmed transaction. The receipt already contains the exact Painted log,
 * including DF1 corruptions, so apply it immediately instead of waiting for another getLogs round trip.
 * We deliberately do not advance snapshotBlock here: another painter can share the same block, and the
 * normal websocket/catch-up path still needs to see those sibling logs. Duplicate receipt/subscription
 * logs are de-duplicated by txHash:logIndex.
 */
export function receiptCoreLogs(
  receiptLogs: readonly Log[],
  receiptBlock: bigint,
  paintAddress = config.paintAddress,
): CoreLog[] {
  const expected = paintAddress?.toLowerCase()
  return receiptLogs.flatMap((log) => {
    if (!log.data || !log.topics || (expected && log.address.toLowerCase() !== expected)) return []
    return [
      {
        blockNumber: log.blockNumber ?? receiptBlock,
        logIndex: log.logIndex == null ? null : Number(log.logIndex),
        transactionHash: log.transactionHash ?? undefined,
        data: log.data,
        topics: log.topics as readonly Hex[],
      },
    ]
  })
}

export function settleInFlightFromReceipt(
  sent: ReadonlyMap<number, number>,
  receiptLogs: readonly Log[],
  receiptBlock: bigint,
) {
  return enqueue(async () => {
    const coreLogs = receiptCoreLogs(receiptLogs, receiptBlock)
    const hasPainted = coreLogs.some((log) => decodeCoreLog(log)?.eventName === 'Painted')
    if (!hasPainted) {
      // Unexpected receipt shape. Keep the old canonical path rather than making the stroke disappear.
      await catchUpNow(receiptBlock)
    } else {
      const needsReload = await applyDeliveredLogs(coreLogs, { advanceSnapshot: false })
      if (needsReload) await loadCanvasNow()
    }
    snapshot = {
      ...snapshot,
      working: clearMatchingInFlight(snapshot.working, snapshot.background, sent),
    }
    emitCanvas()
    // Reconcile in the background. The UI is already exact for this transaction, while this catches
    // sibling transactions from the same block and preserves the store's canonical overlap checks.
    void catchUp(receiptBlock).catch(() => undefined)
  })
}

export function tileNeedsFetch(cached: TileCacheEntry | undefined, headBlock: bigint, force = false) {
  return force || !cached || cached.stale || headBlock - cached.block > 10n
}

export async function readTileState(tile: number, headBlock: bigint, force = false) {
  if (!publicClient || !config.paintAddress) return undefined
  const cached = tileCache.get(tile)
  if (!tileNeedsFetch(cached, headBlock, force)) return cached!.state
  const result = (await publicClient.readContract({
    address: config.paintAddress,
    abi: R3TARDS_PAINT_ABI,
    functionName: 'tileState',
    args: [snapshot.season, tile],
  })) as readonly bigint[]
  const state = { heat: Number(result[1]), wetBitmap: result[2] }
  tileCache.set(tile, { state, block: headBlock, stale: false })
  emitTiles()
  return state
}

export async function readTileStates(tiles: readonly number[], headBlock: bigint, force = false) {
  const client = publicClient
  if (!client || !config.paintAddress) return new Map<number, TilePreviewState>()
  const needed = [...new Set(tiles)].filter((tile) => {
    const cached = tileCache.get(tile)
    return tileNeedsFetch(cached, headBlock, force)
  })
  if (needed.length) {
    // Heat view can need all 256 tiles at once. Use Multicall3 instead of emitting
    // hundreds of individual eth_call requests into the public-RPC limiter.
    const results = (await readMany(
      needed.map((tile) => ({
        address: config.paintAddress!,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'tileState',
        args: [snapshot.season, tile],
      })),
      { allowFailure: false },
    )) as readonly (readonly bigint[])[]
    results.forEach((result, index) => {
      tileCache.set(needed[index], {
        state: { heat: Number(result[1]), wetBitmap: result[2] },
        block: headBlock,
        stale: false,
      })
    })
    emitTiles()
  }
  const out = new Map<number, TilePreviewState>()
  for (const tile of tiles) {
    const entry = tileCache.get(tile)
    if (entry) out.set(tile, entry.state)
  }
  return out
}

export function __applyLogsForTests(logs: readonly CoreLog[]) {
  return applyDeliveredLogs(logs)
}

export function __setAppliedLogKeysForTests(entries: readonly [string, bigint][]) {
  appliedLogKeys.clear()
  for (const [key, block] of entries) appliedLogKeys.set(key, block)
}
