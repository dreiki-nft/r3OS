import { describe, expect, it } from 'vitest'
import { safeRouteInt } from './route'
import { routeNumber } from '../labs/AuctionProgram'
import { describeFrames } from '../os/programs/recycleIntent'

describe('route params from shared links', () => {
  it('accept only plain integers', () => {
    expect(safeRouteInt('12')).toBe(12)
    expect(safeRouteInt(null)).toBe(0)
    expect(safeRouteInt('abc')).toBe(0)
    expect(safeRouteInt('1e9')).toBe(0)
    expect(safeRouteInt('-3')).toBe(0)
    expect(safeRouteInt('9'.repeat(20))).toBe(0)
  })

  it('auction ids never throw on junk', () => {
    expect(routeNumber('token', '#/auction?token=7')).toBe(7n)
    expect(routeNumber('token', '#/auction?token=abc')).toBe(0n)
    expect(routeNumber('token', '#/auction?token=1.5')).toBe(0n)
    expect(routeNumber('token', '#/auction')).toBe(0n)
  })

  it('names the frames a burn confirm is about', () => {
    expect(describeFrames([12])).toBe('frame #12')
    expect(describeFrames([3, 7])).toBe('frames #3 and #7')
    expect(describeFrames([1, 2, 3, 4, 5])).toBe('frames #1, #2, #3 and 2 more')
  })
})
