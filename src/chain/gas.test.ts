import { describe, expect, it } from 'vitest'
import { corruptionKMax, gasLimitFor, maxCostWei } from './gas'

describe('gas policy', () => {
  it('computes and caps DF1 corruption headroom', () => {
    expect(corruptionKMax(1)).toBe(1)
    expect(corruptionKMax(1_566)).toBe(32)
    expect(corruptionKMax(3_000)).toBe(32)
  })

  it('adds corruption headroom and 10%', () => {
    expect(gasLimitFor('corePaint', 100_000n, 100)).toBe(136_400n)
    expect(gasLimitFor('corePaint', 100_000n, 1)).toBe(123_200n)
    expect(gasLimitFor('corePaint', 100_000n, 1_566)).toBe(532_400n)
    expect(gasLimitFor('corePaint', 100_000n, 3_000)).toBe(532_400n)
  })

  it('uses fixed lab limits', () => {
    expect(gasLimitFor('flipbookPaint', 1n)).toBe(240_000n)
    expect(gasLimitFor('forkPaint', 1n)).toBe(250_000n)
  })

  it('rounds the estimate path upward', () => {
    expect(gasLimitFor('estimate', 101n)).toBe(112n)
  })

  it('computes max cost', () => {
    expect(maxCostWei(10n, 3n)).toBe(30n)
  })
})
