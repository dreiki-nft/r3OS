import { describe, expect, it } from 'vitest'
import type { Address } from 'viem'
import { FINALE_HOLDER_WINDOW, finaleEligibility } from './finale'

const HOLDER = '0x0000000000000000000000000000000000000001' as Address
const APPROVED = '0x0000000000000000000000000000000000000002' as Address
const OTHER = '0x0000000000000000000000000000000000000003' as Address

describe('finale mint eligibility', () => {
  const endedAt = 1_000n

  it('allows the token #0 holder and approved operators during the holder window', () => {
    expect(
      finaleEligibility({
        successfulPaints: 1n,
        finaleMinted: false,
        endsAt: endedAt,
        now: endedAt + 1n,
        tokenZeroOwner: HOLDER,
        account: HOLDER,
        operatorApproved: false,
      }).canMint,
    ).toBe(true)
    expect(
      finaleEligibility({
        successfulPaints: 1n,
        finaleMinted: false,
        endsAt: endedAt,
        now: endedAt + 1n,
        tokenZeroOwner: HOLDER,
        account: APPROVED,
        approved: APPROVED,
        operatorApproved: false,
      }).canMint,
    ).toBe(true)
  })

  it('keeps strangers out for seven days, then lets anyone mint to the holder', () => {
    const before = finaleEligibility({
      successfulPaints: 1n,
      finaleMinted: false,
      endsAt: endedAt,
      now: endedAt + FINALE_HOLDER_WINDOW - 1n,
      tokenZeroOwner: HOLDER,
      account: OTHER,
      operatorApproved: false,
    })
    expect(before.publicOpen).toBe(false)
    expect(before.canMint).toBe(false)

    const after = finaleEligibility({
      successfulPaints: 1n,
      finaleMinted: false,
      endsAt: endedAt,
      now: endedAt + FINALE_HOLDER_WINDOW + 1n,
      tokenZeroOwner: HOLDER,
      account: OTHER,
      operatorApproved: false,
    })
    expect(after.publicOpen).toBe(true)
    expect(after.canMint).toBe(true)
  })

  it('rejects empty or already-minted finales', () => {
    expect(
      finaleEligibility({
        successfulPaints: 0n,
        finaleMinted: false,
        endsAt: endedAt,
        now: endedAt + FINALE_HOLDER_WINDOW + 1n,
        tokenZeroOwner: HOLDER,
        account: OTHER,
        operatorApproved: false,
      }).ready,
    ).toBe(false)
    expect(
      finaleEligibility({
        successfulPaints: 1n,
        finaleMinted: true,
        endsAt: endedAt,
        now: endedAt + FINALE_HOLDER_WINDOW + 1n,
        tokenZeroOwner: HOLDER,
        account: OTHER,
        operatorApproved: false,
      }).ready,
    ).toBe(false)
  })
})
