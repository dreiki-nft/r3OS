import { HEIGHT, WIDTH } from './palette'
import type { Hex } from 'viem'

/**
 * Diff two 256x256 palette-index buffers into compact onchain horizontal runs:
 * [y, xStart, xEnd, colorIndex]. Only changed pixels are emitted.
 */
export function encodeChangedRuns(
  baseline: Uint8Array,
  working: Uint8Array,
): {
  bytes: Uint8Array
  hex: Hex
  pixelWrites: number
  runCount: number
} {
  const out: number[] = []
  let pixelWrites = 0

  for (let y = 0; y < HEIGHT; y += 1) {
    let x = 0
    while (x < WIDTH) {
      const i = y * WIDTH + x
      if (baseline[i] === working[i]) {
        x += 1
        continue
      }

      const color = working[i]
      const start = x
      x += 1

      while (x < WIDTH) {
        const j = y * WIDTH + x
        if (baseline[j] === working[j] || working[j] !== color) break
        x += 1
      }

      const end = x - 1
      out.push(y, start, end, color)
      pixelWrites += end - start + 1
    }
  }

  const bytes = Uint8Array.from(out)
  const hex = `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}` as Hex
  return { bytes, hex, pixelWrites, runCount: out.length / 4 }
}

export function decodePackedCanvas(hex: Hex): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const packed = new Uint8Array(clean.length / 2)
  for (let i = 0; i < packed.length; i += 1) {
    packed[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }

  const pixels = new Uint8Array(WIDTH * HEIGHT)
  for (let i = 0; i < packed.length; i += 1) {
    pixels[i * 2] = packed[i] >> 4
    pixels[i * 2 + 1] = packed[i] & 0x0f
  }
  return pixels
}
