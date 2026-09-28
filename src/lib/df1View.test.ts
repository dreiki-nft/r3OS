import { describe, expect, it } from 'vitest'
import {
  buildDf1Source64,
  df1View64,
  outlineCellCounts,
  outlineGenesisFromRuns,
  source64Indices,
} from './df1View'

const PALETTE = [
  0xffffff, 0x000000, 0x965e4b, 0x877549, 0xc52020, 0xfec343, 0xee93e3, 0xffffff, 0x07992f, 0xa0055d,
  0x694b87, 0x5feddf, 0xf7931a, 0xc864aa, 0x9f70da, 0xd47827,
]

function naiveIndices(frameData: Uint8Array, outlineGenesis: Uint8Array, face: number) {
  const out = new Uint8Array(64 * 64)
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      let count = 0
      for (let dy = 0; dy < 4; dy++) {
        const sourceY = y * 4 + dy
        const row = (255 - sourceY) * 128
        for (let dx = 0; dx < 4; dx++) {
          const sourceX = x * 4 + dx
          const packed = outlineGenesis[row + (sourceX >> 1)]
          const nibble = (sourceX & 1) === 0 ? packed >> 4 : packed & 0x0f
          if (nibble !== 0) count++
        }
      }
      const sourceRow = 255 - 4 * y
      out[y * 64 + x] = count >= 6 ? face : frameData[sourceRow * 128 + x * 2] >> 4
    }
  }
  return out
}

describe('DF1 source view', () => {
  it('uses the same >=6-of-16 outline threshold as a naive reference', () => {
    const frame = new Uint8Array(32_768)
    const runs = Uint8Array.from([0, 0, 2, 1, 0, 2, 4, 4, 7])
    const outlineGenesis = outlineGenesisFromRuns(runs)
    const fast = buildDf1Source64({
      frameData: frame,
      outlineGenesis,
      palette: PALETTE,
      face: 1,
      background: 0,
    })
    const fastIndices = source64Indices(frame, outlineGenesis, 1)
    const slowIndices = naiveIndices(frame, outlineGenesis, 1)
    expect(fastIndices).toEqual(slowIndices)
    expect([...fast.slice(0, 3)]).toEqual([0, 0, 0])
    expect([...fast.slice((64 * 1 + 1) * 3, (64 * 1 + 1) * 3 + 3)]).toEqual([255, 255, 255])
  })

  it('counts overlapping outline runs once', () => {
    const frame = new Uint8Array(32_768)
    const runs = Uint8Array.from([10, 0, 3, 10, 0, 3])
    const outlineGenesis = outlineGenesisFromRuns(runs)
    const counts = outlineCellCounts(outlineGenesis)
    expect(counts[2 * 64]).toBe(4)
    const indices = source64Indices(frame, outlineGenesis, 1)
    expect(indices[2 * 64]).toBe(0)
    const rgb = buildDf1Source64({
      frameData: frame,
      outlineGenesis,
      palette: PALETTE,
      face: 1,
      background: 0,
    })
    expect([...rgb.slice(2 * 64 * 3, 2 * 64 * 3 + 3)]).toEqual([255, 255, 255])
  })

  it('source64Indices matches a naive distinct-pixel threshold fixture', () => {
    const frame = new Uint8Array(32_768)
    for (let i = 0; i < frame.length; i++) frame[i] = ((i & 0x0f) << 4) | ((i + 1) & 0x0f)
    const runs = Uint8Array.from([8, 0, 3, 9, 0, 3, 10, 0, 3, 11, 2, 3, 20, 20, 31, 21, 24, 27])
    const outlineGenesis = outlineGenesisFromRuns(runs)
    expect(source64Indices(frame, outlineGenesis, 7)).toEqual(naiveIndices(frame, outlineGenesis, 7))
  })

  it('returns RGB after applying DF1', () => {
    const source = new Uint8Array(64 * 64 * 3).fill(127)
    const out = df1View64(source, 333, 100)
    expect(out).toHaveLength(source.length)
    expect(out).not.toEqual(Uint8ClampedArray.from(source))
  })
})
