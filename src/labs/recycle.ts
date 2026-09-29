export type RecyclePath = 'safeTransfer' | 'approveThenRecycle' | 'recycle'

export type RecycleLogCache<T> = { scannedTo: bigint; rows: T[] }
export type RecycleLogCacheValue<T> = RecycleLogCache<T> | T[] | undefined
export type RecycleScanPlan =
  | { mode: 'none' }
  | { mode: 'incremental'; fromBlock: bigint; toBlock: bigint }
  | { mode: 'backward'; toBlock: bigint }

export function recyclePath(count: number, operatorApproved: boolean): RecyclePath {
  if (count <= 0) throw new Error('pick at least one frame')
  if (count > 50) throw new Error('the Recycle Bin accepts at most 50 frames at once')
  if (operatorApproved) return 'recycle'
  return count === 1 ? 'safeTransfer' : 'approveThenRecycle'
}

export function binEligibleFrames<T extends { id: number; finale: boolean }>(frames: readonly T[]) {
  return frames.filter((frame) => frame.id !== 0 && !frame.finale)
}

export function cdEligibleFrames<T extends { id: number }>(frames: readonly T[]) {
  return frames.filter((frame) => frame.id !== 0)
}

export function recycleCacheRows<T>(cached: RecycleLogCacheValue<T>): T[] {
  if (!cached) return []
  return Array.isArray(cached) ? [...cached] : [...cached.rows]
}

export function recycleScanPlan<T>(
  cached: RecycleLogCacheValue<T>,
  head: bigint,
  maxBlocks: number | bigint,
): RecycleScanPlan {
  if (!cached || Array.isArray(cached)) return { mode: 'backward', toBlock: head }
  if (cached.scannedTo === head) return { mode: 'none' }
  if (cached.scannedTo > head) return { mode: 'backward', toBlock: head }
  const gap = head - cached.scannedTo
  if (gap > BigInt(maxBlocks)) return { mode: 'backward', toBlock: head }
  return { mode: 'incremental', fromBlock: cached.scannedTo + 1n, toBlock: head }
}

export function mergeRecycleRows<T extends { id: number; deletedAt: bigint }>(
  cached: readonly T[],
  fresh: readonly T[],
  limit = 100,
): T[] {
  const merged = new Map<string, T>()
  for (const row of [...cached, ...fresh]) merged.set(`${row.id}:${row.deletedAt}`, row)
  return [...merged.values()]
    .sort((a, b) => (a.deletedAt === b.deletedAt ? b.id - a.id : a.deletedAt < b.deletedAt ? 1 : -1))
    .slice(0, limit)
}
