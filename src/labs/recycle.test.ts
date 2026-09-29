import { describe, expect, it } from 'vitest'
import {
  binEligibleFrames,
  cdEligibleFrames,
  mergeRecycleRows,
  recycleCacheRows,
  recyclePath,
  recycleScanPlan,
} from './recycle'

describe('recycle path choice', () => {
  it('uses the no-approval safe-transfer path for one frame', () => {
    expect(recyclePath(1, false)).toBe('safeTransfer')
  })

  it('approves once before recycling several frames', () => {
    expect(recyclePath(3, false)).toBe('approveThenRecycle')
  })

  it('recycles directly when operator approval already exists', () => {
    expect(recyclePath(3, true)).toBe('recycle')
  })
})

describe('picker filters', () => {
  const frames = [
    { id: 0, finale: false },
    { id: 1, finale: false },
    { id: 2, finale: true },
  ]

  it('excludes token zero and finales from the Bin', () => {
    expect(binEligibleFrames(frames).map((frame) => frame.id)).toEqual([1])
  })

  it('excludes token zero but keeps finales for CDs', () => {
    expect(cdEligibleFrames(frames).map((frame) => frame.id)).toEqual([1, 2])
  })
})

describe('Recycle Bin log cache', () => {
  const row = (id: number, deletedAt: bigint) => ({ id, deletedAt })

  it('reads the old bare-array cache shape and falls back to a backward scan', () => {
    const cached = [row(1, 90n)]
    expect(recycleCacheRows(cached)).toEqual(cached)
    expect(recycleScanPlan(cached, 100n, 50)).toEqual({ mode: 'backward', toBlock: 100n })
  })

  it('continues a new cache incrementally when the gap fits the bounded window', () => {
    const cached = { scannedTo: 90n, rows: [row(1, 90n)] }
    expect(recycleCacheRows(cached)).toEqual(cached.rows)
    expect(recycleScanPlan(cached, 100n, 50)).toEqual({
      mode: 'incremental',
      fromBlock: 91n,
      toBlock: 100n,
    })
  })

  it('does not scan when the cache already reaches head', () => {
    expect(recycleScanPlan({ scannedTo: 100n, rows: [] }, 100n, 50)).toEqual({ mode: 'none' })
  })

  it('falls back to a bounded backward scan when the incremental gap is too large', () => {
    expect(recycleScanPlan({ scannedTo: 40n, rows: [] }, 100n, 50)).toEqual({
      mode: 'backward',
      toBlock: 100n,
    })
  })

  it('merges, deduplicates, sorts newest first and applies the row limit', () => {
    const cached = [row(1, 10n), row(2, 20n)]
    const fresh = [row(2, 20n), row(3, 30n)]
    expect(mergeRecycleRows(cached, fresh, 2)).toEqual([row(3, 30n), row(2, 20n)])
  })
})
