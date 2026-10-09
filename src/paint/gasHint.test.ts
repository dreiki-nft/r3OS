import { describe, expect, it } from 'vitest'
import { parseEther } from 'viem'
import { formatMon, gasHint, LOW_STROKES } from './gasHint'

const stroke = parseEther('0.02')

describe('Need MON? hint', () => {
  it('says nothing until it knows the balance, and nothing when the wallet is comfortable', () => {
    expect(gasHint({ chainId: 143 })).toBeUndefined()
    expect(gasHint({ balance: parseEther('5'), strokeCost: stroke, chainId: 143 })).toBeUndefined()
    // no quote yet and some MON: don't guess
    expect(gasHint({ balance: parseEther('0.001'), chainId: 143 })).toBeUndefined()
  })

  it('explains an empty wallet, with the real per-stroke cost once a quote exists', () => {
    expect(gasHint({ balance: 0n, chainId: 143 })).toEqual({
      kind: 'empty',
      network: 'mainnet',
      perStroke: undefined,
    })
    expect(gasHint({ balance: 0n, strokeCost: stroke, chainId: 143 })).toMatchObject({
      perStroke: '0.02 MON',
    })
    expect(gasHint({ balance: 0n, chainId: 10143 })).toMatchObject({ network: 'testnet' })
  })

  it('catches a balance that cannot pay for this stroke, and warns when only a few are left', () => {
    expect(gasHint({ balance: parseEther('0.01'), strokeCost: stroke, chainId: 143 })).toEqual({
      kind: 'short',
      perStroke: '0.02 MON',
      balance: '0.01 MON',
    })
    expect(gasHint({ balance: parseEther('0.07'), strokeCost: stroke, chainId: 143 })).toEqual({
      kind: 'low',
      strokes: 3,
      perStroke: '0.02 MON',
    })
    expect(
      gasHint({ balance: stroke * BigInt(LOW_STROKES), strokeCost: stroke, chainId: 143 }),
    ).toBeUndefined()
  })

  it('formats small amounts without rounding them to zero', () => {
    expect(formatMon(0n)).toBe('0 MON')
    expect(formatMon(parseEther('0.0042'))).toBe('0.0042 MON')
    expect(formatMon(parseEther('0.000123456'))).toBe('0.00012 MON')
    expect(formatMon(parseEther('12.345'))).toBe('12.35 MON')
  })
})
