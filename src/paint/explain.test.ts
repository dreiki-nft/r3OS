import { describe, expect, it } from 'vitest'
import { formatWait, overheatReason } from './explain'

const constants = {
  MAX_TILE_HEAT: 512n,
  TILE_COOLDOWN_PER_BLOCK: 2n,
}

describe('paint explanations', () => {
  it('formats waits from the observed block cadence', () => {
    expect(formatWait(50, 300)).toBe('15 s')
    expect(formatWait(250, 300)).toBe('1:15')
    expect(formatWait(1_000, 300)).toBe('5:00')
    expect(formatWait(200_000, 300)).toBe('17 h')
  })

  it('falls back to 300 ms when no usable cadence exists yet', () => {
    expect(formatWait(250, 0)).toBe('1:15')
    expect(formatWait(250, Number.NaN)).toBe('1:15')
  })

  it('explains how long until a hot tile can fit the stroke', () => {
    // 500 heat + 100 added = 600. It is 88 over the cap and drains 2/block: 44 blocks at 300 ms ≈ 14 s.
    expect(overheatReason([{ tile: 37, heat: 500, add: 100 }], constants, 300)).toBe(
      'tile 37 is hot (500/512). try again in ~14 s if it stays quiet.',
    )
  })

  it('uses the slowest-cooling tile when a stroke crosses several hot tiles', () => {
    const message = overheatReason(
      [
        { tile: 1, heat: 510, add: 4 },
        { tile: 2, heat: 512, add: 200 },
      ],
      constants,
      300,
    )
    expect(message).toContain('tile 2')
    expect(message).toContain('+1 more hot')
  })

  it('asks for a split when one stroke adds more heat than a tile can ever hold', () => {
    expect(overheatReason([{ tile: 5, heat: 0, add: 600 }], constants, 300)).toContain(
      'paint it in smaller steps',
    )
  })

  it('returns nothing when no tile overheats', () => {
    expect(overheatReason([], constants, 300)).toBeUndefined()
  })
})
