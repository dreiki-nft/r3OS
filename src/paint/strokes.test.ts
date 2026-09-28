import { describe, expect, it } from 'vitest'
import { drawStrokeSegment } from './strokes'

describe('paint strokes', () => {
  it('connects a fast diagonal pointer path without gaps', () => {
    const canvas = new Uint8Array(256 * 256)
    const points = [
      { x: 20, y: 20 },
      { x: 32, y: 23 },
      { x: 46, y: 27 },
      { x: 60, y: 30 },
    ]
    for (let index = 1; index < points.length; index++) {
      drawStrokeSegment(canvas, points[index - 1], points[index], 'pencil', 4, 1)
    }
    for (let x = 20; x <= 60; x++) {
      expect(canvas.some((value, index) => value === 4 && Math.abs((index % 256) - x) <= 1)).toBe(true)
    }
  })
})
