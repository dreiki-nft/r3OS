import { describe, expect, it } from 'vitest'
import { FIT_STEP, nextFitSize } from './fitSize'

describe('zoom to fit', () => {
  it('snaps to whole steps', () => {
    expect(nextFitSize(0, 410) % FIT_STEP).toBe(0)
    expect(nextFitSize(0, 410)).toBe(400)
  })

  it('ignores a line of text wrapping differently above or below the canvas', () => {
    let size = nextFitSize(0, 410)
    const seen = new Set<number>()
    for (const available of [395, 410, 392, 410, 395]) {
      size = nextFitSize(size, available)
      seen.add(size)
    }
    // One shrink so nothing is cut off, then it stays put.
    expect([...seen]).toEqual([384])
  })

  it('settles after one shrink when the space flips around a step boundary', () => {
    let size = nextFitSize(0, 390) // 384
    const seen = new Set<number>()
    for (const available of [380, 390, 380, 390, 380]) {
      size = nextFitSize(size, available)
      seen.add(size)
    }
    expect([...seen]).toEqual([368])
  })

  it('shrinks at once so the canvas is never cut off, and grows when the window grows', () => {
    expect(nextFitSize(512, 400)).toBe(400)
    expect(nextFitSize(384, 760)).toBe(752)
  })

  it('never goes below a usable size', () => {
    expect(nextFitSize(384, 40)).toBe(128)
  })
})
