import { describe, expect, it } from 'vitest'
import { standingFor } from './seasonRank'

describe('season standing', () => {
  const painters = {
    painters: [
      { address: '0x00000000000000000000000000000000000000a1', rank: 1 },
      { address: '0x00000000000000000000000000000000000000b2', rank: 2 },
    ],
  }
  const storms = { wallets: [{ address: '0x00000000000000000000000000000000000000B2', tickets: 3 }] }

  it('finds the rank and tickets case-insensitively', () => {
    expect(standingFor('0x00000000000000000000000000000000000000B2', painters, storms)).toEqual({
      rank: 2,
      of: 2,
      tickets: 3,
    })
  })

  it('works before the files exist and for wallets not in them', () => {
    expect(standingFor('0x00000000000000000000000000000000000000ff', painters, storms)).toEqual({
      rank: undefined,
      of: 2,
      tickets: 0,
    })
    expect(standingFor('0x00000000000000000000000000000000000000a1')).toEqual({
      rank: undefined,
      of: undefined,
      tickets: 0,
    })
  })
})
