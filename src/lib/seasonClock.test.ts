import { describe, expect, it } from 'vitest'
import { duration, seasonClock } from './seasonClock'

const timing = { SEASON_START: 1_000n, SEASON_LENGTH: 30n * 86_400n }

describe('seasonClock', () => {
  it('names the current season and when it ends', () => {
    expect(seasonClock(1_000, timing)).toMatchObject({ season: 1, label: 'season 1 ends in 30 d 0 h' })
    expect(seasonClock(1_000 + 30 * 86_400 + 3_600, timing)).toMatchObject({
      season: 2,
      label: 'season 2 ends in 29 d 23 h',
    })
  })

  it('handles a season that has not started and a bad length', () => {
    expect(seasonClock(400, timing)?.label).toBe('season 1 starts in 10 min')
    expect(seasonClock(5_000, { SEASON_START: 0n, SEASON_LENGTH: 0n })).toBeUndefined()
  })

  it('formats short durations', () => {
    expect(duration(3_700)).toBe('1 h 1 min')
    expect(duration(20)).toBe('1 min')
    expect(duration(-5)).toBe('1 min')
  })
})
