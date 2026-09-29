import { describe, expect, it } from 'vitest'
import {
  CANVAS_PAGES,
  advanceDefrag,
  canvasPage,
  countColdWarm,
  flipbookStorageTouches,
  paintStorageTouches,
  startDefrag,
} from './defrag'

const run = (y: number, x0: number, x1: number, colour = 4) =>
  `0x${[y, x0, x1, colour].map((value) => value.toString(16).padStart(2, '0')).join('')}` as const

describe('Disk Defragmenter storage mapping', () => {
  it('maps canvas slots into 8 pages of 32 rows each', () => {
    expect(canvasPage(0, 0)).toBe(0)
    expect(canvasPage(255, 31)).toBe(0)
    expect(canvasPage(0, 32)).toBe(1)
    expect(canvasPage(255, 255)).toBe(CANVAS_PAGES - 1)
  })

  it('a canvas paint also touches its region page', () => {
    const touches = paintStorageTouches(run(70, 130, 132), 1_234n)
    const region = (70 >> 6) * 4 + (130 >> 6)
    expect(touches.some((touch) => touch.drive === 'C' && touch.page === CANVAS_PAGES + region)).toBe(true)
  })

  it('maps the Flipbook ring as 16 slots per frame and 4 pages', () => {
    expect(flipbookStorageTouches(0n, 1n)[0]).toMatchObject({ page: 0, slot: 0 })
    expect(flipbookStorageTouches(7n, 1n).at(-1)).toMatchObject({ page: 0, slot: 127 })
    expect(flipbookStorageTouches(8n, 1n)[0]).toMatchObject({ page: 1, slot: 128 })
    expect(flipbookStorageTouches(31n, 1n).at(-1)).toMatchObject({ page: 3, slot: 511 })
  })

  it('counts the first touch of a page as cold and later touches as warm', () => {
    const touches = [
      { drive: 'C' as const, page: 0, slot: 1, mode: 'write' as const, blockNumber: 1n },
      { drive: 'C' as const, page: 0, slot: 2, mode: 'write' as const, blockNumber: 1n },
      { drive: 'C' as const, page: 1, slot: 128, mode: 'read' as const, blockNumber: 1n },
    ]
    expect(countColdWarm(touches)).toEqual({ cold: 2, warm: 1, total: 3, pages: 2 })
  })
})

describe('Disk Defragmenter animation', () => {
  it('ends in the completion state without relying on timers', () => {
    let state = startDefrag()
    for (let index = 0; index < 20 && state.phase !== 'complete'; index++) state = advanceDefrag(state)
    expect(state).toEqual({ phase: 'complete', progress: 100 })
  })
})
