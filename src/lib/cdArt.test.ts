import { describe, expect, it } from 'vitest'
import { keccak256, stringToHex } from 'viem'
import {
  DISC_MASK,
  discMaskFromCounts,
  normalizeCdLabel,
  sampleTrackCounts,
  svg,
  trackColours,
} from './cdArt'

const GOLDENS = [
  {
    name: 'single',
    tokenId: 42,
    frameIds: [1204],
    label: 'first paint',
    mask: 0x0060,
    hash: '0x818c3eb8155f40eac866389e048d85034106e898a1fa36b821593f723033a0f4',
  },
  {
    name: 'ep',
    tokenId: 7,
    frameIds: [88, 1204, 5, 77],
    label: 'gm tracks',
    mask: 0x2570,
    hash: '0xd75d0c753f43324ac3cf6330997befbae004bc6ea1f87d09a93263802079ba75',
  },
  {
    name: 'album',
    tokenId: 213,
    frameIds: [3, 9, 27, 81, 243, 729, 2187],
    label: 'summer mix & more',
    mask: 0x7920,
    hash: '0xe2e53dd35f3fc8cef836f7e2f5c2288385bcc6c15b37a4e0b12762c5c9db3ab7',
  },
  {
    name: 'full length',
    tokenId: 1205,
    frameIds: [11, 22, 33, 44, 55, 66, 77, 88, 99, 110, 121, 132],
    label: 'storm chasers',
    mask: DISC_MASK,
    hash: '0xdbef0896bf7c39547bc98acb85bbb92bcec89d36e5bc3e97dca6c169e5856b36',
  },
  {
    name: 'plain silver',
    tokenId: 12345,
    frameIds: [500, 501],
    label: 'b&w only',
    mask: 0,
    hash: '0x96b2de8b224bbadecc868a9b590d63be8e45aac8c5bc7cbd51e3f62aa3615838',
  },
  {
    name: 'one colour',
    tokenId: 3,
    frameIds: [9],
    label: 'all green',
    mask: 1 << 8,
    hash: '0x796dfc178a1b46e14086e612a5c437f9ba966004e43fdfcddab0a65132ccde2d',
  },
] as const

describe('cd art', () => {
  for (const golden of GOLDENS) {
    it(`matches the ${golden.name} golden`, () => {
      const art = svg(golden).svg
      expect(keccak256(stringToHex(art))).toBe(golden.hash)
    })
  }

  it('picks the top two disc colours and keeps lower-index ties first', () => {
    const counts = Array<number>(16).fill(0)
    counts[4] = 9
    counts[5] = 12
    counts[8] = 12
    expect(trackColours(counts)).toEqual([5, 8])
  })

  it('ignores black and white and accepts a single disc colour', () => {
    const excluded = Array<number>(16).fill(0)
    excluded[1] = 100
    excluded[7] = 100
    expect(trackColours(excluded)).toEqual([])
    expect(discMaskFromCounts([excluded])).toBe(0)

    const mono = Array<number>(16).fill(0)
    mono[8] = 1
    expect(trackColours(mono)).toEqual([8])
    expect(discMaskFromCounts([mono])).toBe(1 << 8)
  })
})

describe('cd frame sampling', () => {
  it('samples the top-left pixel of each 8x8 block from bottom-up 4bpp data', () => {
    const packed = new Uint8Array(32_768)
    // Top visual row lives at source row 255. Each sampled x is the high nibble of byte x * 4.
    packed[255 * 128] = 0x50
    packed[255 * 128 + 4] = 0x80
    // Second sampled visual row lives at source row 247. Zero resolves to the supplied background.
    packed[247 * 128] = 0x00
    const counts = sampleTrackCounts(packed, 4)
    expect(counts[5]).toBe(1)
    expect(counts[8]).toBe(1)
    expect(counts[4]).toBe(1022)
  })
})

describe('cd label validation', () => {
  it('folds uppercase and mirrors the contract alphabet and lengths', () => {
    expect(normalizeCdLabel('').valid).toBe(false)
    expect(normalizeCdLabel('A')).toEqual({ valid: true, value: 'a' })
    expect(normalizeCdLabel('abcdefghijklmnopqrstuvwx').valid).toBe(true)
    expect(normalizeCdLabel('abcdefghijklmnopqrstuvwxy').valid).toBe(false)
    expect(normalizeCdLabel('bad_name').valid).toBe(false)
    expect(normalizeCdLabel('bad"name').valid).toBe(false)
    expect(normalizeCdLabel("GM! #1, ok? & it's-good.")).toEqual({
      valid: true,
      value: "gm! #1, ok? & it's-good.",
    })
  })
})
