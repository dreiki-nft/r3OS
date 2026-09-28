import { describe, expect, it } from 'vitest'
import { decodeWorldBitmap, patternPreviewCells } from './weeds'

describe('weeds bitmap', () => {
  it('decodes MSB-left worldBitmap rows', () => {
    const bytes = new Uint8Array(8192)
    bytes[0] = 0x81
    bytes[31] = 0x01
    const cells = decodeWorldBitmap(bytes)
    expect(cells[0]).toBe(1)
    expect(cells[7]).toBe(1)
    expect(cells[255]).toBe(1)
    expect(cells[1]).toBe(0)
  })
})

describe('weeds pattern preview', () => {
  it('matches the contract glider table', () => {
    expect(patternPreviewCells(0, 0, 0)).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ])
  })

  it('matches the contract acorn table and wraps', () => {
    expect(patternPreviewCells(4, 63, 63)).toEqual([
      { x: 0, y: 63 },
      { x: 2, y: 0 },
      { x: 63, y: 1 },
      { x: 0, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 1 },
      { x: 5, y: 1 },
    ])
  })
})
