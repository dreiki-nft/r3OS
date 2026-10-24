import { describe, expect, it } from 'vitest'
import { fingerprint, holderOf, steps, ticketLines, ticketRanges, winningTicket } from './raffleModel'

// The Storm Chasers board after storm 5 (public/storms/season-1.json), in the board's own order (most tickets first).
const BOARD = [
  { address: '0x251A11a49b45f9ee2320E9CFC978994830B93dEd', tickets: 4 },
  { address: '0xC493F2059cBE13583A97A3F1104027582071AD43', tickets: 4 },
  { address: '0xE9264871fAEB0C7fa7Cba6e97B40c4eB89Bfe161', tickets: 4 },
  { address: '0x533E332D90b69e3cCAad79c6C1A7b6fc644e0622', tickets: 3 },
  { address: '0x79F095C916aBF6861333939B44453D1f4DB4134c', tickets: 2 },
  { address: '0x3496A0Da043108Ec81022ebEcced3D0cf821A58D', tickets: 1 },
  { address: '0x3d0de3A76cd9f856664DC5a3adfd4056E45da9ED', tickets: 1 },
  { address: '0x3E0918895094d86ea70889DC8db8c8Bc3986c203', tickets: 1 },
  { address: '0xb2053e2c060472091eBaBBc52c50d2F97Cf6aAeb', tickets: 1 },
  { address: '0xC35b0b63FBbabbe889fD9f22AA6eC0Fba6961dD0', tickets: 1 },
  { address: '0xF6c87ffd936BC68EB29b554E38A0a37aE8AA21c4', tickets: 1 },
]

describe('raffle check', () => {
  it('rebuilds the exact list storm-chasers published (same fingerprint)', () => {
    const entries = ticketRanges(BOARD)
    expect(ticketLines(entries)).toHaveLength(23)
    expect(entries[0]).toMatchObject({
      address: '0x251A11a49b45f9ee2320E9CFC978994830B93dEd',
      from: 0,
      to: 3,
    })
    // printed by `node scripts/storm-chasers.mjs` after storm 5 (snapshotHash)
    expect(fingerprint(entries)).toBe('0xc67379687a5e49f748a10c5fe973de336e3f13d83482e8f8119aee6fc082ee00')
  })

  it('maps a random number to a ticket and its holder like the contract', () => {
    const entries = ticketRanges(BOARD)
    expect(winningTicket('0x0000000000000000000000000000000000000000000000000000000000000020', 23)).toBe(9)
    expect(holderOf(entries, 9)?.entry.address).toBe(entries.find((e) => e.from <= 9 && e.to >= 9)!.address)
    expect(holderOf(entries, 99)).toBeUndefined()
  })

  it('skips team wallets forward', () => {
    const entries = ticketRanges([
      { address: '0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA', tickets: 2 },
      { address: '0x0000000000000000000000000000000000000001', tickets: 1 },
    ])
    // sorted: 0x0000…01 (ticket 0), then the team wallet (tickets 1-2)
    expect(holderOf(entries, 2)).toMatchObject({
      entry: { address: '0x0000000000000000000000000000000000000001' },
      skipped: 1,
    })
  })

  it('only marks onchain steps done for this season', () => {
    expect(steps(5, 21, 6, false).filter((s) => s.done)).toHaveLength(0)
    expect(steps(21, 21, 3, true).map((s) => s.done)).toEqual([true, true, true, false, false, false])
  })
})
