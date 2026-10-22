import { describe, expect, it } from 'vitest'
import { parseEther } from 'viem'
import {
  FUNDING_SETTLE_BLOCKS,
  fundingShortfall,
  quickFunding,
  retryFreshFundingStart,
  withStep,
} from './quickStart'
import { burnerFundTooLarge, fundingSuggestion, MAX_BURNER_FUND } from './liveStore'

const GWEI = 1_000_000_000n

describe('quickFunding', () => {
  it('suggests ~20 paints plus startSession when that fits under the burner cap', () => {
    // (20 × 200k + 150k) × 100 gwei = 0.415 MON → 0.5 MON
    expect(quickFunding(0n, 200_000n, 150_000n, 100n * GWEI)).toBe(parseEther('0.5'))
  })

  it('fits 20 paints at a gas spike that the old 1 MON cap could not cover', () => {
    // (20 × 1.2M + 300k) × 204 gwei = 4.957 MON → 5 MON, under the 10 MON cap
    expect(fundingSuggestion(1_200_000n, 300_000n, 204n * GWEI)).toBe(parseEther('5'))
  })

  it('caps an expensive 20-paint target at the browser-key safety ceiling', () => {
    expect(fundingSuggestion(1_200_000n, 300_000n, 1_000n * GWEI)).toBe(MAX_BURNER_FUND)
    expect(quickFunding(0n, 1_200_000n, 300_000n, 1_000n * GWEI)).toBe(MAX_BURNER_FUND)
  })

  it('tops up to the capped total without rounding the delta past the cap', () => {
    expect(quickFunding(parseEther('0.05'), 1_200_000n, 300_000n, 1_000n * GWEI)).toBe(
      parseEther('9.95'),
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
    expect(MAX_BURNER_FUND).toBe(parseEther('10'))
    expect(burnerFundTooLarge(parseEther('5'))).toBe(false)
    expect(burnerFundTooLarge(parseEther('10'))).toBe(false)
    expect(burnerFundTooLarge(parseEther('10.1'))).toBe(true)
    expect(burnerFundTooLarge(parseEther('0.1'), parseEther('9.9'))).toBe(false)
    expect(burnerFundTooLarge(parseEther('0.2'), parseEther('9.9'))).toBe(true)
  })
})


describe('funded burner settlement', () => {
  it('deliberately waits several Monad blocks before the first funded startSession', () => {
    expect(FUNDING_SETTLE_BLOCKS).toBe(3n)
  })
})

describe('fresh funding start retry', () => {
  it('retries one transient invalid-params style rejection only after this flow funded the burner', () => {
    const stale = new Error('Missing or invalid parameters. Double check you have provided the correct parameters.')
    expect(retryFreshFundingStart(stale, true)).toBe(true)
    expect(retryFreshFundingStart(stale, false)).toBe(false)
    expect(retryFreshFundingStart(new Error('execution reverted: InvalidSessionSignature'), true)).toBe(false)
  })
})

describe('funding shortfall', () => {
  it('says how much MON Live Mode needs before the wallet popup, and stays quiet when it fits', () => {
    const value = parseEther('2.4')
    const fee = 21_000n * 200n * GWEI
    expect(fundingShortfall(parseEther('5'), value, fee)).toBeUndefined()
    expect(fundingShortfall(undefined, value, fee)).toBeUndefined()
    const text = fundingShortfall(parseEther('1.25'), value, fee)!
    expect(text).toContain('about 2.4 MON')
    expect(text).toContain('has 1.25 MON')
    expect(text).toContain('needs about 2.405 MON')
    expect(text).toContain('nothing was sent')
  })

  it('retries a just-funded start that the node refused as "Transaction creation failed"', () => {
    const refused = new Error('Transaction creation failed.\n\nDetails: insufficient balance')
    expect(retryFreshFundingStart(refused, true)).toBe(true)
    expect(retryFreshFundingStart(refused, false)).toBe(false)
  })
})

describe('failed step in the error', () => {
  it('names the step that failed, once, and leaves a closed wallet alone', () => {
    const tagged = withStep(new Error('the network refused the transaction. nothing was sent.'), 'funding') as Error & {
      friendly: { message: string }
    }
    expect(tagged.message).toBe('the network refused the transaction. nothing was sent. (step: funding the paint key)')
    expect(tagged.friendly.message).toBe(tagged.message)
    expect((withStep(tagged, 'start') as Error).message).toBe(tagged.message)

    const closed = Object.assign(new Error('User rejected the request.'), { code: 4001 })
    expect(withStep(closed, 'signature')).toBe(closed)
  })
})

describe('empty wallet', () => {
  it('explains a 0 MON wallet in plain words (checked before the node is asked to estimate the transfer)', () => {
    const text = fundingShortfall(0n, parseEther('0.5'), 21_000n * 200n * GWEI)!
    expect(text).toContain('your wallet has 0 MON')
    expect(text).toContain('nothing was sent')
  })
})
