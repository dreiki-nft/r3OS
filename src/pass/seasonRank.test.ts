import { describe, expect, it } from 'vitest'
import { paintersPath, rankCells, standingFor } from './seasonRank'

describe('season standing', () => {
  const season1 = {
    season: 1,
    file: {
      painters: [
        { address: '0x00000000000000000000000000000000000000a1', rank: 1 },
        { address: '0x00000000000000000000000000000000000000b2', rank: 2 },
      ],
    },
  }
  const season2 = {
    season: 2,
    file: {
      season: 2,
      painters: [
        { address: '0x00000000000000000000000000000000000000b2', rank: 1 },
        { address: '0x00000000000000000000000000000000000000c3', rank: 2 },
        { address: '0x00000000000000000000000000000000000000d4', rank: 3 },
      ],
    },
  }
  const storms = { wallets: [{ address: '0x00000000000000000000000000000000000000B2', tickets: 3 }] }

  it('finds the rank in every season, newest first, and the tickets, case-insensitively', () => {
    expect(standingFor('0x00000000000000000000000000000000000000B2', [season1, season2], storms)).toEqual({
      seasons: [
        { season: 2, rank: 1, of: 3 },
        { season: 1, rank: 2, of: 2 },
      ],
      tickets: 3,
    })
  })

  it('works before the files exist and for wallets that skipped a season', () => {
    expect(standingFor('0x00000000000000000000000000000000000000a1', [season1, season2], storms)).toEqual({
      seasons: [
        { season: 2, rank: undefined, of: 3 },
        { season: 1, rank: 1, of: 2 },
      ],
      tickets: 0,
    })
    expect(standingFor('0x00000000000000000000000000000000000000a1')).toEqual({ seasons: [], tickets: 0 })
  })

  it('shows the newest two seasons, with a dash where the wallet did not paint', () => {
    const standing = standingFor('0x00000000000000000000000000000000000000a1', [season1, season2])
    expect(rankCells(standing)).toEqual([
      ['SEASON 2 RANK', '—'],
      ['SEASON 1 RANK', '#1 of 2'],
    ])
    expect(rankCells(standingFor('0x00000000000000000000000000000000000000a1', [season1]))).toEqual([
      ['SEASON 1 RANK', '#1 of 2'],
    ])
    expect(rankCells(undefined)).toEqual([['SEASON RANK', '—']])
  })

  it('keeps season 1 at its old path', () => {
    expect(paintersPath(1)).toBe('/season/painters.json')
    expect(paintersPath(2)).toBe('/season/painters-2.json')
  })
})
