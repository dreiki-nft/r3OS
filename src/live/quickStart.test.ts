import { describe, expect, it } from 'vitest'
import { parseEther } from 'viem'
import { quickFunding } from './quickStart'

const GWEI = 1_000_000_000n

describe('quickFunding', () => {
  it('suggests ~100 paints plus startSession, rounded up to 0.1 MON', () => {
    // (100 × 200k + 150k) × 100 gwei = 2.015 MON → 2.1 MON
    expect(quickFunding(0n, 200_000n, 150_000n, 100n * GWEI)).toBe(parseEther('2.1'))
  })

  it('tops up only what is missing', () => {
    expect(quickFunding(parseEther('0.3'), 200_000n, 150_000n, 100n * GWEI)).toBe(parseEther('1.8'))
  })

  it('skips the funding prompt when the burner can already cover 20 paints and the start', () => {
    // (20 × 200k + 150k) × 100 gwei = 0.415 MON
    expect(quickFunding(parseEther('0.415'), 200_000n, 150_000n, 100n * GWEI)).toBe(0n)
    expect(quickFunding(parseEther('0.4'), 200_000n, 150_000n, 100n * GWEI)).toBeGreaterThan(0n)
  })
})

describe('burner funding cap', () => {
  it('refuses to move more than pocket change into a browser-held key', async () => {
    const { burnerFundTooLarge, MAX_BURNER_FUND } = await import('./liveStore')
    expect(MAX_BURNER_FUND).toBe(parseEther('10'))
    expect(burnerFundTooLarge(parseEther('2.1'))).toBe(false)
    expect(burnerFundTooLarge(parseEther('10'))).toBe(false)
    expect(burnerFundTooLarge(parseEther('10.1'))).toBe(true)
    // An absurd fee quote (10,000 gwei) makes the suggestion blow past the cap: quick start refuses it.
    expect(burnerFundTooLarge(quickFunding(0n, 200_000n, 150_000n, 10_000n * GWEI))).toBe(true)
  })
})
