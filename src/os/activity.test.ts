import { describe, expect, it } from 'vitest'
import {
  boxesNear,
  canEmit,
  isSuppressed,
  MIN_GAP_MS,
  MIN_GAP_NARROW_MS,
  paintFocused,
  QUIET_AFTER_BOOT_MS,
  unionBox,
  youveGotPaintBody,
} from './activity'
import type { Stroke } from '../paint/presence'
import { nicknameFor } from '../chain/names'

const stroke = (owner: string, x: number, pixels = 10): Stroke => ({
  key: `${owner}:${x}`,
  owner,
  block: 1n,
  pixels,
  box: { x0: x, y0: x, x1: x + 3, y1: x + 3 },
})

describe("You've Got Paint", () => {
  it('stays quiet during boot, the welcome box and the first 30 s', () => {
    expect(isSuppressed({ booting: true, firstRun: false, now: 0 })).toBe(true)
    expect(isSuppressed({ booting: false, firstRun: true, now: 0 })).toBe(true)
    expect(
      isSuppressed({ booting: false, firstRun: false, bootEndedAt: 0, now: QUIET_AFTER_BOOT_MS - 1 }),
    ).toBe(true)
    expect(isSuppressed({ booting: false, firstRun: false, bootEndedAt: 0, now: QUIET_AFTER_BOOT_MS })).toBe(
      false,
    )
    expect(isSuppressed({ booting: false, firstRun: false, now: 5 })).toBe(false)
  })

  it('does not interrupt someone already looking at Paint', () => {
    expect(paintFocused({ active: 'paint', windows: [{ id: 'paint', minimized: false }] })).toBe(true)
    expect(paintFocused({ active: 'paint', windows: [{ id: 'paint', minimized: true }] })).toBe(false)
    expect(paintFocused({ active: 'frames', windows: [{ id: 'paint', minimized: false }] })).toBe(false)
  })

  it('shows at most one balloon every 2 min, 5 min on phones', () => {
    expect(canEmit(undefined, 0, false)).toBe(true)
    expect(canEmit(0, MIN_GAP_MS - 1, false)).toBe(false)
    expect(canEmit(0, MIN_GAP_MS, false)).toBe(true)
    expect(canEmit(0, MIN_GAP_MS, true)).toBe(false)
    expect(canEmit(0, MIN_GAP_NARROW_MS, true)).toBe(true)
  })

  it('says who painted, how much, and whether it was next to your art', () => {
    const one = [stroke('0x1234567890abcdef1234567890abcdef12345678', 100, 12)]
    // Painters are named the same way everywhere: their .nad name, else their fixed nickname.
    const who = nicknameFor('0x1234567890abcdef1234567890abcdef12345678')
    expect(youveGotPaintBody(one, [])).toBe(`${who} just painted 12 px.`)
    expect(youveGotPaintBody(one, [{ x0: 110, y0: 110, x1: 112, y1: 112 }])).toBe(
      `${who} just painted 12 px right next to your art.`,
    )
    const many = [stroke('0xa', 0, 600), stroke('0xb', 50, 600), stroke('0xa', 90, 1)]
    expect(youveGotPaintBody(many, [{ x0: 200, y0: 200, x1: 210, y1: 210 }])).toBe(
      '2 painters just painted 1,201 px.',
    )
  })

  it('measures nearness and the box around a batch', () => {
    expect(boxesNear({ x0: 0, y0: 0, x1: 3, y1: 3 }, { x0: 19, y0: 0, x1: 20, y1: 3 })).toBe(true)
    expect(boxesNear({ x0: 0, y0: 0, x1: 3, y1: 3 }, { x0: 20, y0: 0, x1: 22, y1: 3 })).toBe(false)
    expect(unionBox([])).toBeUndefined()
    expect(
      unionBox([
        { x0: 5, y0: 9, x1: 6, y1: 10 },
        { x0: 1, y0: 20, x1: 3, y1: 30 },
      ]),
    ).toEqual({ x0: 1, y0: 9, x1: 6, y1: 30 })
  })
})
