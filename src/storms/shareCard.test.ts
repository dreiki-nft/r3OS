import { describe, expect, it } from 'vitest'
import { cardHeadline, cardSquares, cardSubline, type CardData } from './shareCard'

const data: CardData = {
  name: 'magmastaking.nad',
  address: '0x251A11a49b45f9ee2320E9CFC978994830B93dEd',
  tickets: 4,
  pending: 1,
  rank: 1,
  wallets: 10,
  caught: [1, 2, 3, 4],
  pendingStorms: [6],
  counted: 5,
  totalStorms: 21,
}

describe('storm card', () => {
  it('counts pending storms in the headline and lists every storm caught', () => {
    expect(cardHeadline(data)).toBe('5 storm tickets')
    expect(cardHeadline({ ...data, tickets: 0, pending: 1 })).toBe('1 storm ticket')
    expect(cardSubline(data)).toBe('rank #1 of 10 · caught storm 1, 2, 3, 4, 6')
    expect(cardSubline({ ...data, rank: undefined, caught: [], pendingStorms: [6] })).toBe('caught storm 6')
  })

  it('marks caught, missed and upcoming storms', () => {
    const squares = cardSquares(data)
    expect(squares).toHaveLength(21)
    expect(squares.slice(0, 7)).toEqual(['caught', 'caught', 'caught', 'caught', 'missed', 'caught', 'ahead'])
  })
})
