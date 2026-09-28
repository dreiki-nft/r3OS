import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, keccak256, stringToBytes, toHex, type Hex } from 'viem'
import {
  brushCell,
  brushColour,
  brushDistinctColours,
  brushFilledCells,
  brushFromBlockhash,
  brushOutlineConflict,
  brushRuns,
} from './brushes'
import { outlineGenesisFromRuns } from './df1View'

const VECTOR0 = 0x0000000000000000060f67080000054e1c344141596545515d758d7246910140n
const VECTOR1 = 0x000000000000000000000001000006261004c0034001300cc7d31694069027d8n
const VECTOR2 = 0x000000000000ffffffffffff0000084d1c34d557128447d144114be105501554n

describe('Block DNA', () => {
  it('matches all three golden vectors', () => {
    expect(brushFromBlockhash(keccak256(stringToBytes('fake block 0')), 101_672_712n)).toBe(VECTOR0)
    expect(brushFromBlockhash(`0x${'0'.repeat(63)}1` as Hex, 1n)).toBe(VECTOR1)
    expect(brushFromBlockhash(`0x${'f'.repeat(64)}` as Hex, 281_474_976_710_655n)).toBe(VECTOR2)
  })

  it('matches the golden run hash', () => {
    expect(keccak256(toHex(brushRuns(VECTOR0, 60, 60)))).toBe(
      '0xfb5f35c1a34b029157232a87417cf48b9de1c21fa230ff53c3f9d81a419e6fcc',
    )
  })

  it('runs cover exactly the filled cells with their colours and preserve mirror symmetry', () => {
    for (let i = 0; i < 1_000; i++) {
      const hash = keccak256(encodeAbiParameters([{ type: 'uint256' }], [BigInt(i)]))
      const brush = brushFromBlockhash(hash, BigInt(1_000_000 + i))
      const runs = brushRuns(brush, 20, 30)
      const covered = new Map<string, number>()
      for (let o = 0; o < runs.length; o += 4) {
        const y = runs[o] - 30
        const x0 = runs[o + 1] - 20
        const x1 = runs[o + 2] - 20
        const colour = runs[o + 3]
        for (let x = x0; x <= x1; x++) covered.set(`${y}:${x}`, colour)
      }

      let filled = 0
      const usedColours = new Set<number>()
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const slot = brushCell(brush, r, c)
          expect(slot).toBe(brushCell(brush, r, 7 - c))
          const key = `${r}:${c}`
          if (slot === 0) {
            expect(covered.has(key)).toBe(false)
          } else {
            filled++
            const colour = brushColour(brush, slot as 1 | 2 | 3)
            usedColours.add(colour)
            expect(covered.get(key)).toBe(colour)
          }
        }
      }
      expect(covered.size).toBe(filled)
      expect(brushFilledCells(brush)).toBe(filled)
      expect(brushDistinctColours(brush)).toBe(usedColours.size)
    }
  })
  it('counts distinct palette colours rather than occupied slots', () => {
    const mono = brushFromBlockhash(keccak256(stringToBytes('dup 0')), 1n)
    const duo = brushFromBlockhash(keccak256(stringToBytes('dup 9')), 10n)
    expect(brushDistinctColours(mono)).toBe(1)
    expect(brushDistinctColours(duo)).toBe(2)
  })

  it('finds the first filled cell that overlaps the protected outline', () => {
    const outline = outlineGenesisFromRuns(Uint8Array.from([10, 20, 23, 11, 22, 22]))
    const fullBrush = 0x55555555555555555555555555555555n | (4n << 128n)
    expect(brushOutlineConflict(fullBrush, 18, 8, outline)).toEqual({ px: 20, py: 10 })
    expect(brushOutlineConflict(fullBrush, 0, 0, outline)).toBeNull()
  })
})
