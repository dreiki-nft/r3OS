import { drawBrush, drawLine, type Point } from '../lib/paintEngine'
import type { Tool } from './Toolbox'

export function protectOutline(buffer: Uint8Array, outline: Uint8Array, before: Uint8Array) {
  for (let index = 0; index < outline.length; index++) {
    if (outline[index]) buffer[index] = before[index]
  }
}

export function drawStrokeSegment(
  buffer: Uint8Array,
  from: Point,
  to: Point,
  tool: Extract<Tool, 'pencil' | 'brush' | 'eraser'>,
  colour: number,
  size: number,
) {
  const value = tool === 'eraser' ? 0 : colour
  const width = tool === 'pencil' ? 1 : size
  if (from.x === to.x && from.y === to.y) drawBrush(buffer, to.x, to.y, value, width)
  else drawLine(buffer, from, to, value, width)
}
