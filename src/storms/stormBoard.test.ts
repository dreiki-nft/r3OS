import { describe, expect, it } from 'vitest'
import { currentOrNextStorm, findWallet, parseBoard, rankBoard, stormNumber } from './stormBoard'
import seed from '../../public/storms/season-1.json'

const A = '0x00000000000000000000000000000000000000a1'
const B = '0x00000000000000000000000000000000000000B2'
const C = '0x00000000000000000000000000000000000000c3'

describe('storm board', () => {
  it('ranks most tickets first and numbers every row 1, 2, 3', () => {
    const rows = rankBoard([
      { address: C, tickets: 1 },
      { address: A, tickets: 3 },
      { address: B, tickets: 3 },
    ])
    expect(rows.map((row) => [row.address, row.rank])).toEqual([
      [A, 1],
      [B, 2],
      [C, 3],
    ])
    expect(findWallet(rows, ' 0x00000000000000000000000000000000000000b2 ')?.tickets).toBe(3)
    expect(findWallet(rows, '0x00000000000000000000000000000000000000ff')).toBeUndefined()
  })

  it('drops malformed rows and keeps the published seed readable', () => {
    const board = parseBoard({
      storms: [{ number: 1, start: '115400000', painters: 1 }],
      wallets: [
        { address: A, tickets: 1 },
        { address: 'nope', tickets: 2 },
        { address: B, tickets: 0 },
      ],
    })
    expect(board.wallets).toHaveLength(1)
    expect(board.totalStorms).toBe(21)
    const published = parseBoard(seed)
    expect(published.wallets.reduce((sum, row) => sum + row.tickets, 0)).toBeGreaterThan(0)
    expect(() => parseBoard(null)).toThrow()
  })

  it('numbers season storms 1-21 and finds the next one', () => {
    expect(stormNumber(115_400_000n)).toBe(1)
    expect(stormNumber(116_200_000n)).toBe(5)
    expect(stormNumber(119_400_000n)).toBe(21)
    expect(stormNumber(119_600_000n)).toBeUndefined()
    expect(currentOrNextStorm(116_150_000n)).toEqual({ start: 116_200_000n, number: 5, now: false })
    expect(currentOrNextStorm(116_200_100n)).toEqual({ start: 116_200_000n, number: 5, now: true })
  })
})

describe('storm schedule', () => {
  it('forecasts the storms still to come from block speed', async () => {
    const { upcomingStorms, stormsIcs, AVG_BLOCK_MS } = await import('./stormBoard')
    const now = Date.UTC(2026, 9, 24, 16, 0)
    const list = upcomingStorms(116_250_000n, now)
    expect(list[0]).toMatchObject({ number: 6, start: 116_400_000n })
    expect(list[0].at).toBeCloseTo(now + 150_000 * AVG_BLOCK_MS, -3)
    expect(list).toHaveLength(16)
    // a storm in progress is still listed
    expect(upcomingStorms(116_200_100n, now)[0].number).toBe(5)
    const ics = stormsIcs(list, now)
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(16)
    expect(ics).toContain('SUMMARY:⚡ r3OS storm 21 of 21')
    expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    for (const line of ics.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(ics.replace(/\r\n /g, '')).toContain('live countdown at https://r3os.app/#/storms')
  })
})

describe('estimated head', () => {
  it('estimates the block from the clock around the anchor', async () => {
    const { estimatedHead } = await import('./stormBoard')
    expect(estimatedHead(1_792_850_127_000)).toBe(116_200_735n)
    expect(estimatedHead(1_792_850_127_000 + 3_023_000)).toBe(116_210_735n)
  })
})
