import { describe, expect, it } from 'vitest'
import { parseEther } from 'viem'
import { quickFunding } from './quickStart'
import { burnerFundTooLarge, fundingSuggestion, MAX_BURNER_FUND } from './liveStore'

const GWEI = 1_000_000_000n

describe('quickFunding', () => {
  it('suggests ~20 paints plus startSession when that fits under the burner cap', () => {
    // (20 × 200k + 150k) × 100 gwei = 0.415 MON → 0.5 MON
    expect(quickFunding(0n, 200_000n, 150_000n, 100n * GWEI)).toBe(parseEther('0.5'))
  })

  it('caps an expensive 20-paint target at the browser-key safety ceiling', () => {
    expect(fundingSuggestion(1_200_000n, 300_000n, 204n * GWEI)).toBe(MAX_BURNER_FUND)
    expect(quickFunding(0n, 1_200_000n, 300_000n, 204n * GWEI)).toBe(MAX_BURNER_FUND)
  })

  it('tops up to the capped total without rounding the delta past the cap', () => {
    expect(quickFunding(parseEther('0.05'), 1_200_000n, 300_000n, 204n * GWEI)).toBe(
      parseEther('0.95'),
    )
  })

  it('skips another wallet prompt once a reused burner covers start plus two typical paints', () => {
    // (2 × 200k + 150k) × 100 gwei = 0.055 MON
    expect(quickFunding(parseEther('0.055'), 200_000n, 150_000n, 100n * GWEI)).toBe(0n)
    expect(quickFunding(parseEther('0.054'), 200_000n, 150_000n, 100n * GWEI)).toBeGreaterThan(0n)
  })
})

describe('burner funding cap', () => {
  it('refuses to move more than pocket change into a browser-held key', () => {
    expect(MAX_BURNER_FUND).toBe(parseEther('1'))
    expect(burnerFundTooLarge(parseEther('0.5'))).toBe(false)
    expect(burnerFundTooLarge(parseEther('1'))).toBe(false)
    expect(burnerFundTooLarge(parseEther('1.1'))).toBe(true)
    expect(burnerFundTooLarge(parseEther('0.1'), parseEther('0.9'))).toBe(false)
    expect(burnerFundTooLarge(parseEther('0.2'), parseEther('0.9'))).toBe(true)
  })
})
