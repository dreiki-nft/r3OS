import { decodeDataUri } from '../lib/dataUri'
import { PALETTE } from '../lib/palette'
import { getCanvasSnapshot } from '../paint/canvasStore'
import {
  getFrameCompositeBytes,
  getFrameImage,
  getLiveCanvasImage,
  type PixelImage,
} from '../frames/frameImage'
import { getFrameInfo } from '../frames/framesStore'
import { readLabsToken } from '../labs/labsToken'

export type ImageResource =
  | { kind: 'frame'; tokenId: number }
  /** withDraft: include the unsent drawing on top (Paint's own Save to floppy), so the file matches the screen. */
  | { kind: 'canvas'; withDraft?: boolean }
  | { kind: 'photo'; labsId: bigint }

export type LoadedImageResource =
  | { kind: 'pixels'; image: PixelImage }
  | { kind: 'svg'; uri: string; text: string }

export type ImageAction = { id: 'wallpaper' | 'floppy'; label: string }

export function resourceFileName(resource: ImageResource) {
  if (resource.kind === 'canvas') return 'CANVAS.BMP'
  if (resource.kind === 'photo') return `PHOTO${resource.labsId.toString().padStart(4, '0')}.SVG`
  return `FRAME${String(resource.tokenId).padStart(4, '0')}.BMP`
}

export function resourceLabel(resource: ImageResource) {
  if (resource.kind === 'canvas') return 'live canvas'
  if (resource.kind === 'photo') return `photo #${resource.labsId}`
  return `frame #${resource.tokenId}`
}

export function imageActions(_resource: ImageResource, _context: { connected: boolean }): ImageAction[] {
  return [
    { id: 'wallpaper', label: 'Set as Wallpaper' },
    { id: 'floppy', label: 'Save to Floppy…' },
  ]
}

export async function loadResourcePixels(resource: ImageResource): Promise<LoadedImageResource> {
  if (resource.kind === 'canvas') {
    const canvas = getCanvasSnapshot()
    if (canvas.status !== 'demo' && canvas.snapshotBlock === 0n) throw new Error('canvas unavailable')
    return { kind: 'pixels', image: getLiveCanvasImage() }
  }
  if (resource.kind === 'frame') return { kind: 'pixels', image: await getFrameImage(resource.tokenId) }
  const data = await readLabsToken(resource.labsId)
  if (!data.image?.startsWith('data:image/svg+xml')) throw new Error('photo image unavailable')
  return { kind: 'svg', uri: data.image, text: decodeDataUri(data.image) }
}

function setUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true)
}

function setUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true)
}

/** Write an uncompressed 256×256, 16-colour BMP around an already bottom-up 4-bpp pixel array. */
export function bmp4(pixelArray: Uint8Array, palette16: readonly [number, number, number][]) {
  if (pixelArray.length !== 32_768) throw new Error(`expected 32768 packed bytes, got ${pixelArray.length}`)
  if (palette16.length !== 16) throw new Error(`expected 16 palette entries, got ${palette16.length}`)

  const pixelOffset = 14 + 40 + 16 * 4
  const fileSize = pixelOffset + pixelArray.length
  const bytes = new Uint8Array(fileSize)
  const view = new DataView(bytes.buffer)

  bytes[0] = 0x42
  bytes[1] = 0x4d
  setUint32(view, 2, fileSize)
  setUint32(view, 10, pixelOffset)

  setUint32(view, 14, 40)
  setUint32(view, 18, 256)
  setUint32(view, 22, 256)
  setUint16(view, 26, 1)
  setUint16(view, 28, 4)
  setUint32(view, 30, 0)
  setUint32(view, 34, pixelArray.length)
  setUint32(view, 38, 2_835)
  setUint32(view, 42, 2_835)
  setUint32(view, 46, 16)
  setUint32(view, 50, 16)

  for (let index = 0; index < 16; index++) {
    const [red, green, blue] = palette16[index]
    const offset = 54 + index * 4
    bytes[offset] = blue
    bytes[offset + 1] = green
    bytes[offset + 2] = red
    bytes[offset + 3] = 0
  }
  bytes.set(pixelArray, pixelOffset)
  return bytes
}

export function basePalette16(): [number, number, number][] {
  return PALETTE.map((entry) => [...entry.rgb] as [number, number, number])
}

export function framePalette16(backgroundColor: number) {
  const palette = basePalette16()
  palette[0] = [...(PALETTE[backgroundColor]?.rgb ?? PALETTE[0].rgb)] as [number, number, number]
  return palette
}

/** Pack the canvas into BMP's bottom-up, high-nibble-left 4-bpp layout; `pixels` defaults to the onchain layer. */
export function packCanvas4Bpp(canvas = getCanvasSnapshot(), pixels: Uint8Array = canvas.background) {
  const packed = new Uint8Array(32_768)
  for (let y = 0; y < 256; y++) {
    const targetRow = 255 - y
    for (let x = 0; x < 256; x += 2) {
      const leftIndex = y * 256 + x
      const rightIndex = leftIndex + 1
      const left = canvas.outline[leftIndex]
        ? canvas.face
        : pixels[leftIndex] === 0
          ? canvas.backgroundColor
          : pixels[leftIndex]
      const right = canvas.outline[rightIndex]
        ? canvas.face
        : pixels[rightIndex] === 0
          ? canvas.backgroundColor
          : pixels[rightIndex]
      packed[targetRow * 128 + (x >> 1)] = ((left & 0x0f) << 4) | (right & 0x0f)
    }
  }
  return packed
}

export async function frameBmp(tokenId: number) {
  if (tokenId <= 0) throw new Error('saved frame required')
  const [pixels, info] = await Promise.all([getFrameCompositeBytes(tokenId), getFrameInfo(tokenId)])
  if (!info) throw new Error('frame not found')
  return { bytes: bmp4(pixels, framePalette16(info.backgroundColor)), blockNumber: info.blockNumber }
}

/** Pixels the person has drawn in Paint but not sent yet (outline pixels never take paint). */
export function unsentPixelCount(canvas = getCanvasSnapshot()) {
  let count = 0
  for (let index = 0; index < canvas.working.length; index++) {
    if (!canvas.outline[index] && canvas.working[index] !== canvas.background[index]) count++
  }
  return count
}

export function canvasBmp(withDraft = false, canvas = getCanvasSnapshot()) {
  if (canvas.status !== 'demo' && canvas.snapshotBlock === 0n) throw new Error('canvas unavailable')
  const unsentPixels = withDraft ? unsentPixelCount(canvas) : 0
  return {
    bytes: bmp4(packCanvas4Bpp(canvas, unsentPixels ? canvas.working : canvas.background), basePalette16()),
    blockNumber: canvas.snapshotBlock,
    unsentPixels,
  }
}
