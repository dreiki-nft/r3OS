import { hexToBytes, type Address, type Hex } from 'viem'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { decodeJsonDataUri } from '../lib/dataUri'
import { applyDf1 } from '../lib/df1'
import { DF1_RENDERER_ABI, R3TARDS_PAINT_ABI, SEASON_TIMELAPSE_RENDERER_ABI } from '../lib/generated/abi'
import { idbGet, idbSet } from '../lib/idb'
import { PALETTE } from '../lib/palette'
import { getCanvasSnapshot } from '../paint/canvasStore'
import { getFrameInfo, type FrameInfo } from './framesStore'

export interface PixelImage {
  width: number
  height: number
  rgba: Uint8ClampedArray
}

export interface RendererInfo {
  id: number
  address?: Address
  name: string
}

export interface Df1Verification {
  matched: number
  total: number
  firstMismatch?: number
  seed: number
  amount: number
}

const rendererMemory = new Map<string, RendererInfo[]>()
const timelapseMemory = new Map<number, string>()

function imageKey(tokenId: number) {
  return `${config.chainId}:${tokenId}`
}

function colour(index: number) {
  return PALETTE[index]?.rgb ?? PALETTE[1].rgb
}

export function decodePacked4Bpp(packed: Uint8Array, backgroundColor: number): PixelImage {
  if (packed.length !== 32_768) throw new Error(`expected 32768 packed bytes, got ${packed.length}`)
  const rgba = new Uint8ClampedArray(256 * 256 * 4)
  for (let y = 0; y < 256; y++) {
    const sourceRow = 255 - y
    for (let x = 0; x < 256; x++) {
      const byte = packed[sourceRow * 128 + (x >> 1)]
      const nibble = (x & 1) === 0 ? byte >> 4 : byte & 0x0f
      const paletteIndex = nibble === 0 ? backgroundColor : nibble
      const [red, green, blue] = colour(paletteIndex)
      const offset = (y * 256 + x) * 4
      rgba[offset] = red
      rgba[offset + 1] = green
      rgba[offset + 2] = blue
      rgba[offset + 3] = 255
    }
  }
  return { width: 256, height: 256, rgba }
}

export function diffPacked4Bpp(
  current: Uint8Array,
  previous: Uint8Array,
  backgroundColor: number,
): PixelImage & { changed: number } {
  if (current.length !== 32_768 || previous.length !== 32_768) throw new Error('invalid frame byte length')
  const image = decodePacked4Bpp(current, backgroundColor)
  let changed = 0
  for (let y = 0; y < 256; y++) {
    const sourceRow = 255 - y
    for (let x = 0; x < 256; x++) {
      const index = sourceRow * 128 + (x >> 1)
      const shift = (x & 1) === 0 ? 4 : 0
      const currentNibble = (current[index] >> shift) & 0x0f
      const previousNibble = (previous[index] >> shift) & 0x0f
      const offset = (y * 256 + x) * 4
      if (currentNibble !== previousNibble) {
        changed++
      } else {
        image.rgba[offset] = Math.round(image.rgba[offset] * 0.25)
        image.rgba[offset + 1] = Math.round(image.rgba[offset + 1] * 0.25)
        image.rgba[offset + 2] = Math.round(image.rgba[offset + 2] * 0.25)
      }
    }
  }
  return { ...image, changed }
}

function rgbToRgba(rgb: Uint8Array, width: number, height: number): PixelImage {
  if (rgb.length !== width * height * 3) throw new Error('invalid rgb byte length')
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let source = 0, target = 0; source < rgb.length; source += 3, target += 4) {
    rgba[target] = rgb[source]
    rgba[target + 1] = rgb[source + 1]
    rgba[target + 2] = rgb[source + 2]
    rgba[target + 3] = 255
  }
  return { width, height, rgba }
}

function rgbaToRgb(rgba: Uint8ClampedArray) {
  const rgb = new Uint8Array((rgba.length / 4) * 3)
  for (let source = 0, target = 0; source < rgba.length; source += 4, target += 3) {
    rgb[target] = rgba[source]
    rgb[target + 1] = rgba[source + 1]
    rgb[target + 2] = rgba[source + 2]
  }
  return rgb
}

export async function getFrameCompositeBytes(tokenId: number) {
  const cached = await idbGet<Uint8Array>('frameImage', imageKey(tokenId))
  if (cached) return new Uint8Array(cached)
  if (!publicClient || !config.paintAddress) throw new Error('frame data unavailable')
  const raw = (await publicClient.readContract({
    address: config.paintAddress,
    abi: R3TARDS_PAINT_ABI,
    functionName: 'frameCompositeData',
    args: [BigInt(tokenId)],
  })) as Hex
  const bytes = new Uint8Array(hexToBytes(raw))
  await idbSet('frameImage', imageKey(tokenId), bytes)
  return bytes
}

export async function getFrameImage(tokenId: number): Promise<PixelImage> {
  if (tokenId === 0) return getLiveCanvasImage()
  const [info, bytes] = await Promise.all([getFrameInfo(tokenId), getFrameCompositeBytes(tokenId)])
  if (!info) throw new Error('frame not found')
  return decodePacked4Bpp(bytes, info.backgroundColor)
}

export function getLiveCanvasImage(): PixelImage {
  const canvas = getCanvasSnapshot()
  const rgba = new Uint8ClampedArray(256 * 256 * 4)
  for (let index = 0; index < 65_536; index++) {
    const paletteIndex = canvas.outline[index]
      ? canvas.face
      : canvas.background[index] === 0
        ? canvas.backgroundColor
        : canvas.background[index]
    const [red, green, blue] = colour(paletteIndex)
    const offset = index * 4
    rgba[offset] = red
    rgba[offset + 1] = green
    rgba[offset + 2] = blue
    rgba[offset + 3] = 255
  }
  return { width: 256, height: 256, rgba }
}

export async function rendererList(force = false) {
  const key = String(config.chainId)
  if (!force && rendererMemory.has(key)) return rendererMemory.get(key)!
  if (!publicClient || !config.paintAddress) return [{ id: 0, name: 'built-in' }]
  const client = publicClient
  const count = Number(
    await client.readContract({
      address: config.paintAddress,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'rendererCount',
    }),
  )
  const values = await Promise.all(
    Array.from(
      { length: count },
      (_, id) =>
        client.readContract({
          address: config.paintAddress!,
          abi: R3TARDS_PAINT_ABI,
          functionName: 'rendererInfo',
          args: [BigInt(id)],
        }) as Promise<readonly [Address, string]>,
    ),
  )
  const list = values.map((value, id) => ({ id, address: value[0], name: value[1] }))
  rendererMemory.set(key, list)
  return list
}

export async function tokenRenderer(tokenId: number) {
  if (!publicClient || !config.paintAddress) return 0
  return Number(
    await publicClient.readContract({
      address: config.paintAddress,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'tokenRenderer',
      args: [BigInt(tokenId)],
    }),
  )
}

export async function getDiffImage(tokenId: number, info?: FrameInfo) {
  if (tokenId === 0) throw new Error('diff does not support the live canvas')
  if (!publicClient || !config.paintAddress) throw new Error('frame data unavailable')
  const frame = info ?? (await getFrameInfo(tokenId))
  if (!frame) throw new Error('frame not found')
  const current = await getFrameCompositeBytes(tokenId)
  let previous: Uint8Array
  if (frame.finale) {
    const seasonInfo = (await publicClient.readContract({
      address: config.paintAddress,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'seasonInfo',
      args: [BigInt(frame.season)],
    })) as readonly unknown[]
    const regularFrames = BigInt(seasonInfo[4] as bigint)
    if (regularFrames === 0n) {
      const raw = (await publicClient.readContract({
        address: config.paintAddress,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'genesisFrameData',
        args: [BigInt(frame.season)],
      })) as Hex
      previous = new Uint8Array(hexToBytes(raw))
    } else {
      const previousId = Number(
        await publicClient.readContract({
          address: config.paintAddress,
          abi: R3TARDS_PAINT_ABI,
          functionName: 'seasonFrameToken',
          args: [BigInt(frame.season), Number(regularFrames)],
        }),
      )
      previous = await getFrameCompositeBytes(previousId)
    }
  } else if (frame.seasonFrameIndex <= 1n) {
    const raw = (await publicClient.readContract({
      address: config.paintAddress,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'genesisFrameData',
      args: [BigInt(frame.season)],
    })) as Hex
    previous = new Uint8Array(hexToBytes(raw))
  } else {
    const previousId = Number(
      await publicClient.readContract({
        address: config.paintAddress,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'seasonFrameToken',
        args: [BigInt(frame.season), Number(frame.seasonFrameIndex - 1n)],
      }),
    )
    previous = await getFrameCompositeBytes(previousId)
  }
  return diffPacked4Bpp(current, previous, frame.backgroundColor)
}

async function df1Renderer() {
  const renderer = (await rendererList()).find((item) => item.name.toLowerCase() === 'df1')
  if (!renderer?.address) throw new Error('df1 renderer is not registered')
  return renderer.address
}

export async function getOnchainDf1(tokenId: number) {
  if (!publicClient || !config.paintAddress) throw new Error('df1 unavailable')
  const renderer = await df1Renderer()
  const raw = (await publicClient.readContract({
    address: renderer,
    abi: DF1_RENDERER_ABI,
    functionName: 'df1Rgb64',
    args: [config.paintAddress, BigInt(tokenId)],
  })) as Hex
  return rgbToRgba(new Uint8Array(hexToBytes(raw)), 64, 64)
}

export function siteDf1Amount(df1Amount: number) {
  return Math.max(100, df1Amount)
}

export async function getSiteDf1(tokenId: number) {
  if (tokenId === 0) throw new Error('live canvas DF1 preview is not enabled yet')
  if (!publicClient || !config.paintAddress) throw new Error('df1 unavailable')
  const [info, image, seedRaw] = await Promise.all([
    getFrameInfo(tokenId),
    getFrameImage(tokenId),
    publicClient.readContract({
      address: config.paintAddress,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'df1Seed',
      args: [BigInt(tokenId)],
    }),
  ])
  if (!info) throw new Error('frame not found')
  const seed = Number(seedRaw)
  const amount = siteDf1Amount(info.df1Amount)
  return { width: 256, height: 256, rgba: applyDf1(image.rgba, seed, amount), seed, amount }
}

export async function verifyDf1(tokenId: number): Promise<Df1Verification> {
  if (!publicClient || !config.paintAddress) throw new Error('df1 unavailable')
  const renderer = await df1Renderer()
  const [sourceRaw, outputRaw] = await Promise.all([
    publicClient.readContract({
      address: renderer,
      abi: DF1_RENDERER_ABI,
      functionName: 'source64',
      args: [config.paintAddress, BigInt(tokenId)],
    }) as Promise<readonly [Hex, number | bigint, bigint]>,
    publicClient.readContract({
      address: renderer,
      abi: DF1_RENDERER_ABI,
      functionName: 'df1Rgb64',
      args: [config.paintAddress, BigInt(tokenId)],
    }) as Promise<Hex>,
  ])
  const source = rgbToRgba(new Uint8Array(hexToBytes(sourceRaw[0])), 64, 64)
  const seed = Number(sourceRaw[1])
  const amount = Number(sourceRaw[2])
  const localRgb = rgbaToRgb(applyDf1(source.rgba, seed, amount))
  const chainRgb = new Uint8Array(hexToBytes(outputRaw))
  let matched = 0
  let firstMismatch: number | undefined
  for (let index = 0; index < chainRgb.length; index++) {
    if (localRgb[index] === chainRgb[index]) matched++
    else if (firstMismatch == null) firstMismatch = index
  }
  return { matched, total: chainRgb.length, firstMismatch, seed, amount }
}

export async function getTimelapseImage(tokenId: number) {
  const cached = timelapseMemory.get(tokenId)
  if (cached) return cached
  const info = await getFrameInfo(tokenId)
  if (!info?.finale) throw new Error('timelapse is finale only')
  const renderer = (await rendererList()).find((item) => item.name.toLowerCase() === 'season timelapse')
  if (!renderer?.address || !publicClient || !config.paintAddress) throw new Error('timelapse unavailable')
  const uri = (await publicClient.readContract({
    address: renderer.address,
    abi: SEASON_TIMELAPSE_RENDERER_ABI,
    functionName: 'tokenURI',
    args: [config.paintAddress, BigInt(tokenId)],
  })) as string
  const metadata = decodeJsonDataUri<{ image?: string }>(uri)
  if (!metadata.image) throw new Error('timelapse image missing')
  timelapseMemory.set(tokenId, metadata.image)
  return metadata.image
}

export function paletteLabel(index: number) {
  return `${PALETTE[index]?.name ?? `colour ${index}`} (${index})`
}
