import { describe, expect, it } from 'vitest'
import { decodePacked4Bpp } from '../frames/frameImage'
import { PALETTE } from '../lib/palette'
import {
  basePalette16,
  bmp4,
  canvasBmp,
  framePalette16,
  imageActions,
  packCanvas4Bpp,
  resourceFileName,
  resourceLabel,
  unsentPixelCount,
} from './imageResources'

describe('image resources', () => {
  it('uses short nostalgic filenames and labels', () => {
    expect(resourceFileName({ kind: 'frame', tokenId: 12 })).toBe('FRAME0012.BMP')
    expect(resourceFileName({ kind: 'canvas' })).toBe('CANVAS.BMP')
    expect(resourceFileName({ kind: 'photo', labsId: 42n })).toBe('PHOTO0042.SVG')
    expect(resourceLabel({ kind: 'photo', labsId: 42n })).toBe('photo #42')
    expect(imageActions({ kind: 'canvas' }, { connected: false }).map((row) => row.id)).toEqual([
      'wallpaper',
      'floppy',
    ])
  })

  it('writes an exact uncompressed 4-bpp BMP and preserves frame pixel bytes', () => {
    const pixels = new Uint8Array(32_768)
    pixels[0] = 0x12
    pixels[pixels.length - 1] = 0xef
    const bytes = bmp4(pixels, basePalette16())
    const view = new DataView(bytes.buffer)
    expect(bytes.length).toBe(32_886)
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('BM')
    expect(view.getUint32(2, true)).toBe(32_886)
    expect(view.getUint32(10, true)).toBe(118)
    expect(view.getUint32(18, true)).toBe(256)
    expect(view.getUint32(22, true)).toBe(256)
    expect(view.getUint16(28, true)).toBe(4)
    expect(view.getUint32(46, true)).toBe(16)
    expect(bytes.slice(118)).toEqual(pixels)
  })

  it('swaps BMP palette entry zero to the frame background', () => {
    const palette = framePalette16(11)
    expect(palette[0]).toEqual(PALETTE[11].rgb)
    expect(palette[1]).toEqual(PALETTE[1].rgb)
  })

  it('packs the displayed canvas bottom-up and round-trips through the frame decoder', () => {
    const background = new Uint8Array(65_536)
    const outline = new Uint8Array(65_536)
    background[0] = 4
    background[1] = 0
    background[255] = 8
    outline[256] = 1
    const packed = packCanvas4Bpp({
      background,
      working: background,
      outline,
      season: 0n,
      face: 11,
      backgroundColor: 5,
      snapshotBlock: 1n,
      status: 'live',
    })
    const image = decodePacked4Bpp(packed, 5)
    const rgbAt = (x: number, y: number) => Array.from(image.rgba.slice((y * 256 + x) * 4, (y * 256 + x) * 4 + 3))
    expect(rgbAt(0, 0)).toEqual(PALETTE[4].rgb)
    expect(rgbAt(1, 0)).toEqual(PALETTE[5].rgb)
    expect(rgbAt(255, 0)).toEqual(PALETTE[8].rgb)
    expect(rgbAt(0, 1)).toEqual(PALETTE[11].rgb)
  })

  it('saves the unsent drawing only when asked, and never over the outline', () => {
    const background = new Uint8Array(65_536)
    const outline = new Uint8Array(65_536)
    background[0] = 4
    outline[256] = 1
    const working = background.slice()
    working[1] = 9
    working[2] = 3
    working[256] = 7
    const canvas = {
      background,
      working,
      outline,
      season: 0n,
      face: 11,
      backgroundColor: 5,
      snapshotBlock: 12n,
      status: 'live' as const,
    }
    expect(unsentPixelCount(canvas)).toBe(2)

    const onchain = canvasBmp(false, canvas)
    expect(onchain.unsentPixels).toBe(0)
    expect(onchain.blockNumber).toBe(12n)

    const withDraft = canvasBmp(true, canvas)
    expect(withDraft.unsentPixels).toBe(2)
    expect(withDraft.bytes).not.toEqual(onchain.bytes)
    const image = decodePacked4Bpp(packCanvas4Bpp(canvas, canvas.working), 5)
    const rgbAt = (x: number, y: number) => Array.from(image.rgba.slice((y * 256 + x) * 4, (y * 256 + x) * 4 + 3))
    expect(rgbAt(0, 0)).toEqual(PALETTE[4].rgb)
    expect(rgbAt(1, 0)).toEqual(PALETTE[9].rgb)
    expect(rgbAt(2, 0)).toEqual(PALETTE[3].rgb)
    expect(rgbAt(0, 1)).toEqual(PALETTE[11].rgb)
  })

  it('keeps the onchain canvas when nothing is unsent', () => {
    const background = new Uint8Array(65_536)
    background[5] = 2
    const canvas = {
      background,
      working: background.slice(),
      outline: new Uint8Array(65_536),
      season: 0n,
      face: 11,
      backgroundColor: 5,
      snapshotBlock: 3n,
      status: 'live' as const,
    }
    expect(canvasBmp(true, canvas)).toEqual(canvasBmp(false, canvas))
  })
})
