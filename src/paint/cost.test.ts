import { describe, expect, it } from 'vitest'
import { previewPaintCost } from './cost'
describe('paint cost', () => {
  it('prices blank wet and dry and skips outline/unchanged', () => {
    const b = new Uint8Array(65536),
      w = b.slice(),
      o = b.slice()
    b[1] = 2
    b[2] = 2
    b[3] = 4
    w[0] = 3
    w[1] = 3
    w[2] = 3
    w[3] = 4
    o[2] = 1
    const tiles = new Map([[0, { heat: 0, wetBitmap: 1n << 1n }]])
    const c = previewPaintCost(b, w, o, tiles, 512)
    expect(c).toMatchObject({ pixels: 2, blank: 1, wet: 1, dry: 0, units: 2 })
  })
  it('predicts overheat', () => {
    const b = new Uint8Array(65536),
      w = b.slice(),
      o = b.slice()
    w[0] = 1
    const c = previewPaintCost(b, w, o, new Map([[0, { heat: 512, wetBitmap: 0n }]]), 512)
    expect(c.overheatTiles).toEqual([0])
  })
})
