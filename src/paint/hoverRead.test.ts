import { describe, expect, it } from 'vitest'
import { HOVER_REFRESH_MS, HOVER_SETTLE_MS, hoverReadDelay } from './hoverRead'

describe('hover tile reads', () => {
  it('waits for the pointer to settle on a new tile', () => {
    expect(hoverReadDelay(5, { tile: 4, at: 1_000 }, 1_010)).toBe(HOVER_SETTLE_MS)
    expect(hoverReadDelay(0, { tile: -1, at: 0 }, 0)).toBe(HOVER_SETTLE_MS)
  })

  it('re-reads a resting tile at most every refresh period, however often blocks arrive', () => {
    expect(hoverReadDelay(4, { tile: 4, at: 1_000 }, 1_400)).toBe(HOVER_REFRESH_MS - 400)
    expect(hoverReadDelay(4, { tile: 4, at: 1_000 }, 1_000 + HOVER_REFRESH_MS + 5)).toBe(0)
    // one read per period: at ~0.4 s blocks that is 15× fewer reads than reading on every block
    expect(HOVER_REFRESH_MS / 400).toBeGreaterThanOrEqual(15)
  })
})
