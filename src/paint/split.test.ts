import { describe, expect, it } from 'vitest'
import { splitPaintRuns, type Run } from './split'
const limits = {
  maxRawPixels: 10,
  regionCap: 8,
  currentBlock: 5n,
  regionUsage: new Map([[0, { block: 5n, pixels: 4 }]]),
  budgetUnits: 20,
}
describe('split', () => {
  it('obeys raw region and budget caps without losing pixels', () => {
    const runs: Run[] = [{ y: 0, x0: 0, x1: 15, color: 1 }]
    const chunks = splitPaintRuns(runs, limits)
    expect(chunks.every((c) => c.pixels <= 10)).toBe(true)
    expect(chunks[0].regionPixels.get(0)).toBeLessThanOrEqual(4)
    expect(chunks.reduce((n, c) => n + c.pixels, 0)).toBe(16)
  })
  it('preserves run order inside region/row and splits only when needed', () => {
    const runs: Run[] = [{ y: 1, x0: 1, x1: 2, color: 3 }]
    expect(
      splitPaintRuns(runs, { ...limits, regionUsage: new Map(), regionCap: 8, budgetUnits: 20 })[0].runs,
    ).toEqual(runs)
  })
})
