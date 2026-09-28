import { describe, expect, it } from 'vitest'
import { keccak256, stringToHex, type Address } from 'viem'
import { candleEndBlock, candleWindow, minNextBid, winnerAt, type AuctionBid } from './auction'

const A = '0x00000000000000000000000000000000000000a1' as Address
const B = '0x00000000000000000000000000000000000000b2' as Address
const C = '0x00000000000000000000000000000000000000c3' as Address

function bruteForce(bids: readonly AuctionBid[], endBlock: bigint): AuctionBid | null {
  let winner: AuctionBid | null = null
  for (const bid of bids) if (bid.blockNumber <= endBlock) winner = bid
  return winner
}

describe('candle auction helpers', () => {
  it('matches the three candle vectors', () => {
    const close = 1_288_700n
    const h = keccak256(stringToHex('close block'))
    expect(candleEndBlock(h, 1n, close)).toBe(1_286_197n)
    expect(candleEndBlock(h, 7n, close)).toBe(1_277_420n)
    expect(candleEndBlock(`0x${0xdeadn.toString(16).padStart(64, '0')}`, 1n, close)).toBe(1_277_551n)
  })

  it('rounds the five-percent raise up', () => {
    expect(minNextBid(10n, 0n, false)).toBe(10n)
    expect(minNextBid(1n, 19n, true)).toBe(20n)
    expect(minNextBid(1n, 100n, true)).toBe(105n)
    expect(minNextBid(1n, 101n, true)).toBe(107n)
  })

  it('selects the last bid at or before the candle', () => {
    expect(winnerAt([], 10n)).toBeNull()
    expect(winnerAt([{ bidder: A, blockNumber: 11n, total: 1n }], 10n)).toBeNull()
    const sameBlock = [
      { bidder: A, blockNumber: 9n, total: 10n },
      { bidder: B, blockNumber: 10n, total: 11n },
      { bidder: C, blockNumber: 10n, total: 12n },
    ]
    expect(winnerAt(sameBlock, 10n)).toEqual(sameBlock[2])
  })

  it('matches a brute-force search across 1,000 deterministic random lists', () => {
    let state = 0x12345678
    const rnd = () => {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      return state >>> 0
    }
    for (let seed = 0; seed < 1_000; seed++) {
      const bids: AuctionBid[] = []
      let block = 100n
      let total = 10n
      const count = rnd() % 80
      for (let i = 0; i < count; i++) {
        block += BigInt(rnd() % 4)
        total += BigInt(1 + (rnd() % 20))
        bids.push({ bidder: [A, B, C][rnd() % 3], blockNumber: block, total })
      }
      const end = 90n + BigInt(rnd() % 150)
      expect(winnerAt(bids, end)).toEqual(bruteForce(bids, end))
    }
  })

  it('returns the bidding and candle windows', () => {
    expect(candleWindow(1_000n)).toEqual({ closeBlock: 288_999n, candleStartBlock: 277_000n })
  })
})
