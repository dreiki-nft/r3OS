import { encodeAbiParameters, keccak256, type Hex } from 'viem'

/** Palette indices a brush may use: 1..15 without 7 (7 is a second white). */
const BRUSH_COLOURS = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15] as const

/** Mirror of BrushDNA.fromBlockhash. Returns the packed brush word. */
export function brushFromBlockhash(blockHash: Hex, blockNumber: bigint): bigint {
  const dna = BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: 'string' }, { type: 'bytes32' }, { type: 'uint256' }],
        ['r3tards.brush.v1', blockHash, blockNumber],
      ),
    ),
  )
  let brush = 0n
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 4; c++) {
      const v = Number((dna >> BigInt(3 * (r * 4 + c))) & 7n)
      const s = BigInt(v <= 2 ? 0 : v <= 5 ? 1 : v === 6 ? 2 : 3)
      brush |= s << BigInt(16 * r + 2 * c)
      brush |= s << BigInt(16 * r + 2 * (7 - c))
    }
  }
  const colour = (shift: bigint) => BigInt(BRUSH_COLOURS[Number((dna >> shift) & 0xffn) % 14])
  brush |= colour(96n) << 128n
  brush |= colour(104n) << 132n
  brush |= colour(112n) << 136n
  brush |= (blockNumber & 0xffffffffffffn) << 160n
  return brush
}

export function brushCell(brush: bigint, r: number, c: number): number {
  return Number((brush >> BigInt(16 * r + 2 * c)) & 3n)
}

export function brushColour(brush: bigint, slot: 1 | 2 | 3): number {
  return Number((brush >> BigInt(124 + 4 * slot)) & 0xfn)
}

/** Mirror of BrushDNA.runs: packed core paint runs (y, x0, x1, colour), top-left at (x, y). */
export function brushRuns(brush: bigint, x: number, y: number): Uint8Array {
  const out: number[] = []
  for (let r = 0; r < 8; r++) {
    let c = 0
    while (c < 8) {
      const s = brushCell(brush, r, c)
      if (s === 0) {
        c++
        continue
      }
      const c0 = c
      while (c + 1 < 8 && brushCell(brush, r, c + 1) === s) c++
      out.push(y + r, x + c0, x + c, brushColour(brush, s as 1 | 2 | 3))
      c++
    }
  }
  return Uint8Array.from(out)
}

export function brushFilledCells(brush: bigint): number {
  let count = 0
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) if (brushCell(brush, r, c) !== 0) count++
  }
  return count
}

export function brushDistinctColours(brush: bigint): number {
  const colours = new Set<number>()
  for (let slot = 1; slot <= 3; slot++) {
    let found = false
    for (let r = 0; r < 8 && !found; r++) {
      for (let c = 0; c < 8; c++) {
        if (brushCell(brush, r, c) === slot) {
          found = true
          break
        }
      }
    }
    if (found) colours.add(brushColour(brush, slot as 1 | 2 | 3))
  }
  return colours.size
}

/** First filled cell that lands on the protected season outline, or null. */
export function brushOutlineConflict(
  brush: bigint,
  x: number,
  y: number,
  outlineGenesis: Uint8Array,
): { px: number; py: number } | null {
  if (outlineGenesis.length !== 32_768) throw new Error('outlineGenesis must be 32768 bytes')
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (brushCell(brush, r, c) === 0) continue
      const px = x + c
      const py = y + r
      if (px < 0 || px >= 256 || py < 0 || py >= 256) continue
      const row = (255 - py) * 128
      const packed = outlineGenesis[row + (px >> 1)]
      const nibble = (px & 1) === 0 ? packed >> 4 : packed & 0x0f
      if (nibble !== 0) return { px, py }
    }
  }
  return null
}
