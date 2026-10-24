import { describe, expect, it } from 'vitest'
import { currentOrNextStorm, findWallet, parseBoard, rankBoard, stormNumber } from './stormBoard'
import seed from '../../public/storms/season-1.json'

const A = '0x00000000000000000000000000000000000000a1'
const B = '0x00000000000000000000000000000000000000B2'
const C = '0x00000000000000000000000000000000000000c3'

describe('storm board', () => {
  it('ranks most tickets first and lets ties share a rank', () => {
    const rows = rankBoard([
      { address: C, tickets: 1 },
      { address: A, tickets: 3 },
      { address: B, tickets: 3 },
    ])
    expect(rows.map((row) => [row.address, row.rank])).toEqual([
      [A, 1],
      [B, 1],
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
