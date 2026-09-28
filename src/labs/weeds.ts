export const WEED_PATTERNS = [
  'glider',
  'LWSS',
  'R-pentomino',
  'blinker',
  'acorn',
  'block',
  'beehive',
  'diehard',
] as const

// Mirrors R3tardsWeeds._pattern exactly. MSB is x=0, first byte is y=0.
export const WEED_PATTERN_BITS = [
  0x4020e00000000000n,
  0x488088f000000000n,
  0x60c0400000000000n,
  0xe000000000000000n,
  0x4010ce0000000000n,
  0xc0c0000000000000n,
  0x6090600000000000n,
  0x02c0470000000000n,
] as const

export function decodeWorldBitmap(bytes: Uint8Array) {
  if (bytes.length !== 8192) throw new Error('worldBitmap must contain 8192 bytes')
  const out = new Uint8Array(256 * 256)
  for (let y = 0; y < 256; y++) {
    for (let byteX = 0; byteX < 32; byteX++) {
      const value = bytes[y * 32 + byteX]
      for (let bit = 0; bit < 8; bit++) out[y * 256 + byteX * 8 + bit] = (value >> (7 - bit)) & 1
    }
  }
  return out
}

export function patternPreviewCells(pattern: number, x: number, y: number) {
  const bits = WEED_PATTERN_BITS[pattern]
  if (bits == null) throw new Error('invalid weeds pattern')
  const cells: { x: number; y: number }[] = []
  for (let py = 0; py < 8; py++) {
    const row = Number((bits >> BigInt((7 - py) * 8)) & 0xffn)
    for (let px = 0; px < 8; px++) {
      if ((row & (1 << (7 - px))) !== 0) cells.push({ x: (x + px) & 63, y: (y + py) & 63 })
    }
  }
  return cells
}
