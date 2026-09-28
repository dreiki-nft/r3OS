import { describe, expect, it } from 'vitest'
import { PALETTE } from '../lib/palette'
import { decodePacked4Bpp, diffPacked4Bpp, siteDf1Amount } from './frameImage'

describe('frame images', () => {
  it('decodes BMP bottom-up rows with the high nibble on the left', () => {
    const packed = new Uint8Array(32_768)
    packed[255 * 128] = 0x12
    const image = decodePacked4Bpp(packed, 6)
    expect([...image.rgba.slice(0, 3)]).toEqual(PALETTE[1].rgb)
    expect([...image.rgba.slice(4, 7)]).toEqual(PALETTE[2].rgb)
  })

  it('maps palette index zero to the saved background colour', () => {
    const image = decodePacked4Bpp(new Uint8Array(32_768), 11)
    expect([...image.rgba.slice(0, 3)]).toEqual(PALETTE[11].rgb)
  })

  it('marks exactly changed pixels and dims the rest', () => {
    const previous = new Uint8Array(32_768)
    const current = previous.slice()
    current[255 * 128] = 0x10
    const image = diffPacked4Bpp(current, previous, 6)
    expect(image.changed).toBe(1)
    expect(image.rgba[0]).toBe(PALETTE[1].rgb[0])
    expect(image.rgba[4]).toBe(Math.round(PALETTE[6].rgb[0] * 0.25))
  })

  it('uses at least 100% for the site DF1 preview', () => {
    expect(siteDf1Amount(0)).toBe(100)
    expect(siteDf1Amount(73)).toBe(100)
    expect(siteDf1Amount(200)).toBe(200)
  })
})
