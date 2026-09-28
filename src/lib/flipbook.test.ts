import { describe, expect, it } from 'vitest'
import { applyFlipRuns, encodeFlipRuns, packFrame, reelTiming, unpackFrame } from './flipbook'
import genesisHex from '../../contracts/script/flipbook-genesis.hex?raw'

function genesisBytes(): Uint8Array {
  const hex = genesisHex.trim().slice(2)
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

describe('flipbook frame packing', () => {
  it('round-trips the canonical genesis', () => {
    const packed = genesisBytes()
    expect(packFrame(unpackFrame(packed))).toEqual(packed)
  })

  it('has exactly 225 black pixels, only in rows 6..25', () => {
    const indices = unpackFrame(genesisBytes())
    let black = 0
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const value = indices[y * 32 + x]
        if (value === 1) {
          black++
          expect(y).toBeGreaterThanOrEqual(6)
          expect(y).toBeLessThanOrEqual(25)
        } else {
          expect(value).toBe(0)
        }
      }
    }
    expect(black).toBe(225)
  })
})

describe('flipbook runs', () => {
  it('encodes and applies changed runs', () => {
    const base = new Uint8Array(1024)
    const working = base.slice()
    working.fill(4, 3, 8)
    working.fill(5, 32 + 10, 32 + 14)
    working[2 * 32 + 31] = 7

    const encoded = encodeFlipRuns(base, working)
    expect(encoded.pixelWrites).toBe(10)
    expect(encoded.runCount).toBe(3)
    expect(encoded.tooManyPixels).toBe(false)
    expect(encoded.tooManyRuns).toBe(false)
    expect(applyFlipRuns(base, encoded.runs)).toEqual(working)
  })

  it('flags pixel and run limits without truncating output', () => {
    const base = new Uint8Array(1024)
    const manyPixels = base.slice()
    manyPixels.fill(1, 0, 65)
    expect(encodeFlipRuns(base, manyPixels).tooManyPixels).toBe(true)

    const manyRuns = base.slice()
    for (let i = 0; i < 33; i++) manyRuns[i * 2] = 1
    const encoded = encodeFlipRuns(base, manyRuns)
    expect(encoded.runCount).toBe(33)
    expect(encoded.tooManyRuns).toBe(true)
  })
})

describe('reel timing', () => {
  it('matches the contract timing fixture', () => {
    const b = 1_000n
    expect(reelTiming([b, b + 1n, b + 4n, b + 5n], 300)).toEqual({
      ticks: [1, 3, 1, 4],
      totalMs: 2700,
      startsPerMille: [0, 111, 444, 555],
    })
  })

  it('clamps block gaps to eight ticks and holds the final frame for four', () => {
    expect(reelTiming([10n, 30n], 300)).toEqual({
      ticks: [8, 4],
      totalMs: 3600,
      startsPerMille: [0, 666],
    })
  })
})
