import { describe, expect, it } from 'vitest'
import {
  MAINNET_TOKENS,
  MAINNET_VENUES,
  bpsDelta,
  classifyCodeHash,
  formatAmount,
  pairsFor,
  parseAmount,
  statusLabel,
  venuesForPair,
} from './venues'

describe('router venue helpers', () => {
  it('discovers unique mainnet pairs and both directions', () => {
    expect(pairsFor(143).length).toBeGreaterThan(1)
    expect(venuesForPair(MAINNET_TOKENS.WMON, MAINNET_TOKENS.USDC).length).toBe(5)
    expect(venuesForPair(MAINNET_TOKENS.USDC, MAINNET_TOKENS.WMON).length).toBe(5)
  })

  it('parses and formats token amounts without Number precision', () => {
    expect(parseAmount('1.234567', 6)).toBe(1_234_567n)
    expect(parseAmount('0.00000001', 8)).toBe(1n)
    expect(parseAmount('1.000000000000000001', 18)).toBe(1_000_000_000_000_000_001n)
    expect(() => parseAmount('1.0000001', 6)).toThrow(/too many decimals/)
    expect(() => parseAmount('0', 18)).toThrow(/greater than zero/)
    expect(formatAmount(1_234_567n, 6)).toBe('1.234567')
  })

  it('computes signed hundredths of a basis point', () => {
    expect(bpsDelta(99n, 100n)).toBe(-10_000n)
    expect(bpsDelta(101n, 100n)).toBe(10_000n)
    expect(bpsDelta(0n, 0n)).toBe(0n)
  })

  it('classifies every status and code hash state', () => {
    for (let i = 0; i < 8; i++) expect(statusLabel(i)).not.toBe('UNKNOWN')
    const hash = MAINNET_VENUES[0].expectedCodeHash!
    expect(classifyCodeHash(hash, hash)).toBe('match')
    expect(classifyCodeHash(`0x${'11'.repeat(32)}`, hash)).toBe('differs')
    expect(classifyCodeHash(undefined, hash, false)).toBe('no-code')
    expect(classifyCodeHash(undefined, undefined, true)).toBe('unknown')
  })
})
