import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetStormLiveForTests,
  noteStormPaint,
  stormPainters,
  stormStartAt,
  uncountedStorms,
} from './stormLive'

describe('storm live view', () => {
  beforeEach(() => __resetStormLiveForTests())

  it('knows which storm a block belongs to', () => {
    expect(stormStartAt(116_400_599n)).toBe(116_400_000n)
    expect(stormStartAt(116_400_600n)).toBeUndefined()
  })

  it('collects storm painters from live paints, ignoring paints between storms', () => {
    noteStormPaint('0xAbC0000000000000000000000000000000000001', 116_400_010n, undefined)
    noteStormPaint('0xabc0000000000000000000000000000000000001', 116_400_020n, undefined)
    noteStormPaint('0x0000000000000000000000000000000000000002', 116_401_000n, undefined)
    expect([...stormPainters(116_400_000n)]).toEqual(['0xabc0000000000000000000000000000000000001'])
  })

  it('lists the storms the board has not counted yet', () => {
    const first = 115_400_000n
    expect(uncountedStorms(116_400_100n, 5, first, 21)).toEqual([
      { number: 6, start: 116_400_000n, live: true },
    ])
    expect(uncountedStorms(116_450_000n, 5, first, 21)[0].live).toBe(false)
    expect(uncountedStorms(116_300_000n, 5, first, 21)).toEqual([])
  })
})
