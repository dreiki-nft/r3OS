import { describe, expect, it } from 'vitest'
import { overlapSummary, regionsFromRunList, regionsFromRuns } from './regions'

describe('X-ray regions', () => {
  it('maps encoded runs with (y >> 6) * 4 + (x >> 6)', () => {
    expect(regionsFromRuns(Uint8Array.from([0, 0, 63, 1, 64, 64, 129, 2]))).toEqual([0, 5, 6])
  })

  it('maps decoded chunk runs without re-encoding them', () => {
    expect(regionsFromRunList([{ y: 120, x0: 100, x1: 130, color: 7 }])).toEqual([5])
  })

  it('describes other paints and overlaps', () => {
    const summary = overlapSummary([5, 6], [[2], [5, 9], [14]])
    expect(summary.otherRegions).toEqual([2, 5, 9, 14])
    expect(summary.overlappingPaints).toBe(1)
    expect(summary.text).toContain('3 other paints')
  })
})
