import { describe, expect, it } from 'vitest'
import { encodeForkDiff, encodeForkRuns, forkRowsToIndices, indicesToForkRows } from './forks'
import { outlineGenesisFromRuns, source64Indices } from './df1View'

describe('fork rows', () => {
  it('round trips 4096 palette indices', () => {
    const indices = new Uint8Array(4096)
    for (let i = 0; i < indices.length; i++) indices[i] = (i * 7 + 3) & 15
    expect(forkRowsToIndices(indicesToForkRows(indices))).toEqual(indices)
  })

  it('round trips the shared Source64 grid exactly', () => {
    const frame = new Uint8Array(32_768)
    for (let i = 0; i < frame.length; i++) frame[i] = ((i & 15) << 4) | ((i + 1) & 15)
    const outline = outlineGenesisFromRuns(Uint8Array.from([0, 0, 7, 1, 0, 7, 2, 0, 7, 20, 40, 55]))
    const source = source64Indices(frame, outline, 7)
    expect(forkRowsToIndices(indicesToForkRows(source))).toEqual(source)
  })
})

describe('fork diff encoding', () => {
  it('encodes a 64x64 pixel diff as 4-byte runs', () => {
    const base = new Uint8Array(4096)
    const working = base.slice()
    working.fill(4, 1, 5)
    working.fill(7, 64 + 10, 64 + 13)
    const encoded = encodeForkDiff(base, working)
    expect(encoded).toMatchObject({ pixels: 7, runs: 2, tooManyPixels: false, tooManyRuns: false })
    expect(encoded.hex).toBe('0x00010404010a0c07')
  })
})

describe('fork run encoding', () => {
  it('encodes valid runs', () => {
    expect(
      encodeForkRuns([
        { y: 0, x0: 1, x1: 3, colour: 4 },
        { y: 63, x0: 63, x1: 63, colour: 15 },
      ]),
    ).toBe('0x000103043f3f3f0f')
  })

  it('stable-sorts runs by row before encoding', () => {
    expect(
      encodeForkRuns([
        { y: 8, x0: 0, x1: 0, colour: 1 },
        { y: 2, x0: 1, x1: 1, colour: 2 },
        { y: 8, x0: 2, x1: 2, colour: 3 },
        { y: 2, x0: 3, x1: 3, colour: 4 },
      ]),
    ).toBe('0x02010102020303040800000108020203')
  })

  it('rejects empty and overlong lists as InvalidRuns', () => {
    expect(() => encodeForkRuns([])).toThrow('InvalidRuns')
    expect(() =>
      encodeForkRuns(Array.from({ length: 33 }, (_, y) => ({ y: y % 64, x0: 0, x1: 0, colour: 1 }))),
    ).toThrow('InvalidRuns')
  })

  for (const [label, run] of [
    ['y', { y: 64, x0: 0, x1: 0, colour: 1 }],
    ['x0', { y: 0, x0: 64, x1: 64, colour: 1 }],
    ['x1', { y: 0, x0: 0, x1: 64, colour: 1 }],
    ['order', { y: 0, x0: 4, x1: 3, colour: 1 }],
    ['colour', { y: 0, x0: 0, x1: 0, colour: 16 }],
    ['integer', { y: 0.5, x0: 0, x1: 0, colour: 1 }],
  ] as const) {
    it(`rejects invalid ${label} as InvalidRuns`, () => {
      expect(() => encodeForkRuns([run])).toThrow('InvalidRuns')
    })
  }

  it('rejects more than 64 requested pixels as TooManyPixels', () => {
    expect(() =>
      encodeForkRuns([
        { y: 0, x0: 0, x1: 63, colour: 1 },
        { y: 1, x0: 0, x1: 0, colour: 1 },
      ]),
    ).toThrow('TooManyPixels(65)')
  })
})
