import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TEAM, checkHistory, findWinner, fingerprint, ticketLines, winningTicket } from './raffle-lib.mjs'

const record = JSON.parse(readFileSync('docs/raffles/storm-season-1.json', 'utf8'))
const board = JSON.parse(readFileSync(record.ticketList.source, 'utf8'))
const list = board.wallets
  .map((w: { address: string; storms: number[] }) => ({
    address: w.address.toLowerCase(),
    tickets: w.storms.length,
  }))
  .sort((a: { address: string }, b: { address: string }) => (a.address < b.address ? -1 : 1))
let running = 0
const wallets: string[] = list.map((e: { address: string }) => e.address)
const cum: number[] = list.map((e: { tickets: number }) => (running += e.tickets))

const W = (n: number) => `0x${n.toString(16).padStart(40, '0')}`

describe('R3tardsRaffle arithmetic, mirrored from the verified source', () => {
  it('rebuilds the published Storm Season list and its fingerprint', () => {
    expect(wallets).toHaveLength(22)
    expect(cum.at(-1)).toBe(156)
    expect(fingerprint(ticketLines(wallets, cum))).toBe(record.ticketList.snapshotHash)
  })

  it('re-does the actual draw: the Pyth number picks ticket 50, which is 0x533E…0622', () => {
    const ticket = winningTicket(record.result.randomNumber, 156)
    expect(ticket).toBe(50n)
    expect(findWinner(wallets, cum, ticket).winner).toBe(record.result.winner.toLowerCase())
  })

  it('handles boundary tickets exactly like the contract', () => {
    expect(findWinner(wallets, cum, 0).index).toBe(0)
    expect(findWinner(wallets, cum, 155).index).toBe(21)
    // A wallet's last ticket is cum - 1; cum itself is the next wallet's first ticket.
    expect(findWinner(wallets, cum, cum[2] - 1).index).toBe(2)
    expect(findWinner(wallets, cum, cum[2]).index).toBe(3)
    // Every ticket maps to the wallet whose range holds it.
    const lines = ticketLines(wallets, cum)
    lines.forEach((owner, ticket) => expect(findWinner(wallets, cum, ticket).winner).toBe(owner))
  })

  it('skips team wallets forward, wrapping around, and fails when only team wallets hold tickets', () => {
    const w = [W(1), TEAM[3], W(3)]
    const c = [1, 3, 4]
    expect(findWinner(w, c, 1)).toMatchObject({ winner: W(3), skipped: 1 })
    const wrap = [W(1), W(2), TEAM[0]]
    expect(findWinner(wrap, [1, 2, 3], 2)).toMatchObject({ winner: W(1), index: 0, skipped: 1 })
    expect(() => findWinner([TEAM[0], TEAM[1]], [1, 2], 0)).toThrow(/NoEligibleWinner/)
    expect(() => ticketLines([W(1), W(2)], [2, 2])).toThrow(/no tickets/)
  })

  it('accepts a clean draw and flags re-rolls, swapped randomness and misdirected claims', () => {
    const zero = '0x0000000000000000000000000000000000000000'
    const R = '0x01'
    const clean = [
      { name: 'SnapshotFinalized', args: {} },
      { name: 'PrizeDeposited', args: {} },
      { name: 'DrawRequested', args: {} },
      { name: 'DrawComplete', args: { winner: zero, winningTicket: 0n, randomNumber: R } },
      { name: 'DrawComplete', args: { winner: W(7), winningTicket: 1n, randomNumber: R } },
      { name: 'PrizeClaimed', args: { winner: W(7) } },
    ]
    expect(checkHistory(clean)).toMatchObject({ ok: true, random: R, winner: W(7), ticket: 1n })
    const reroll = [...clean.slice(0, 4), { name: 'PrizeRecovered', args: {} }, ...clean.slice(1)]
    const rerolled = checkHistory(reroll)
    expect(rerolled.ok).toBe(false)
    expect(rerolled.problems.join(' ')).toMatch(/re-roll/)
    expect(rerolled.problems.join(' ')).toMatch(/2 draw requests/)
    const swapped = clean.map((e) =>
      e.name === 'DrawComplete' && e.args.winner !== zero
        ? { ...e, args: { ...e.args, randomNumber: '0x02' } }
        : e,
    )
    expect(checkHistory(swapped).problems.join(' ')).toMatch(/different random number/)
    const elsewhere = clean.map((e) => (e.name === 'PrizeClaimed' ? { ...e, args: { winner: W(9) } } : e))
    expect(checkHistory(elsewhere).problems.join(' ')).toMatch(/someone other/)
    expect(checkHistory(clean.filter((e) => e.name !== 'PrizeClaimed')).problems).toContain(
      '0 prize claims (expected 1)',
    )
  })
})
