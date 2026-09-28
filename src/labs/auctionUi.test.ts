import { describe, expect, it } from 'vitest'
import { auctionActions, auctionBarPosition } from './AuctionProgram'

describe('auction UI helpers', () => {
  it('maps start, now and close positions', () => {
    expect(auctionBarPosition(100n, 100n, 200n)).toBe(0)
    expect(auctionBarPosition(150n, 100n, 200n)).toBe(50)
    expect(auctionBarPosition(200n, 100n, 200n)).toBe(100)
  })
  it('enables settlement and withdrawals from contract state', () => {
    const info = { state: 1, closeBlock: 200n } as any
    expect(auctionActions(info, 201n, 0n, 0n).settle).toBe(true)
    const settled = { state: 2, closeBlock: 200n } as any
    expect(auctionActions(settled, 201n, 1n, 2n)).toEqual({
      settle: false,
      withdrawBid: true,
      withdrawProceeds: true,
    })
  })
})
