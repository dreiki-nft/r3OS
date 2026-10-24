import { describe, expect, it } from 'vitest'
import { parseReplay } from '../replay/replayData'
import { applyPaint, buildPixelHistory, pixelInfo } from './pixelHistory'

const A = '0x00000000000000000000000000000000000000a1'
const B = '0x00000000000000000000000000000000000000b2'
const hex = (bytes: number[]) => `0x${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}` as const

function replay() {
  return parseReplay({
    version: 1,
    chainId: 143,
    paint: '0x5102de3817ae16b3afaeb9d180130669a70787b3',
    season: 0,
    fromBlock: '1000',
    toBlock: '2000',
    fromTime: 1,
    toTime: 2,
    face: 1,
    background: 11,
    outline: hex([0, 0, 0]), // pixel (0,0) is the protected outline
    painters: [A, B],
    events: [
      [10, 0, hex([0, 0, 3, 4]), '0x'], // A paints y=0, x 0..3 red (x=0 is outline, skipped)
      [20, 1, hex([0, 2, 2, 5]), hex([3, 0, 9])], // B paints (2,0) gold; DF1 glitches (3,0) to magenta
      [30, 0, hex([0, 1, 1, 4]), '0x'], // A repaints (1,0) the same red: not a change
    ],
  })
}

describe('pixel history', () => {
  it('knows the last wallet, block and number of real changes for each pixel', () => {
    const h = buildPixelHistory(replay())
    expect(pixelInfo(h, 0, 0)).toEqual({ painted: false })
    expect(pixelInfo(h, 1, 0)).toEqual({ painted: true, address: A, block: 1010, changes: 1, glitch: false })
    expect(pixelInfo(h, 2, 0)).toEqual({ painted: true, address: B, block: 1020, changes: 2, glitch: false })
    expect(pixelInfo(h, 3, 0)).toEqual({ painted: true, address: B, block: 1020, changes: 2, glitch: true })
    expect(pixelInfo(h, 9, 9)).toEqual({ painted: false })
  })

  it('keeps going with live paints after the replay', () => {
    const h = buildPixelHistory(replay())
    const c = h.painters.push('0x00000000000000000000000000000000000000c3') - 1
    applyPaint(h, c, 2050, new Uint8Array([0, 1, 1, 7]))
    expect(pixelInfo(h, 1, 0)).toMatchObject({ address: h.painters[c], block: 2050, changes: 2 })
  })
})
