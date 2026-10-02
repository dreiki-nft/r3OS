import { describe, expect, it } from 'vitest'
import type { TxTrace } from '../chain/txTrace'
import { shouldNudge, walletPaintsConfirmed } from './liveNudge'

const trace = (action: string, signer: TxTrace['signer'] = 'wallet', landed = true): TxTrace => ({
  hash: `0x${Math.random().toString(16).slice(2).padEnd(64, '0')}`,
  action,
  signer,
  regions: [],
  gasLimit: 1n,
  maxFeePerGas: 1n,
  t: { sent: 0 },
  blockNumber: landed ? 5n : undefined,
})

describe('live nudge', () => {
  it('counts only landed wallet paints', () => {
    expect(
      walletPaintsConfirmed([
        trace('paint 12 px'),
        trace('paint 40 px', 'burner'),
        trace('paint 3 px', 'wallet', false),
        trace('paint 9 px and save frame'),
        trace('mintFrame'),
        trace('paint 1 px'),
      ]),
    ).toBe(2)
  })

  it('asks after the 2nd paint, once, and never in live mode or after "don\'t ask again"', () => {
    const base = { walletPaints: 2, live: false, never: false, shown: false }
    expect(shouldNudge(base)).toBe(true)
    expect(shouldNudge({ ...base, walletPaints: 1 })).toBe(false)
    expect(shouldNudge({ ...base, live: true })).toBe(false)
    expect(shouldNudge({ ...base, never: true })).toBe(false)
    expect(shouldNudge({ ...base, shown: true })).toBe(false)
  })
})
