import { loadResourcePixels, resourceLabel, type ImageResource } from './imageResources'
import { pushBalloon } from './balloons'

export type WallpaperMode = 'tile' | 'center' | 'stretch'
export interface WallpaperSetting {
  resource?: ImageResource
  mode: WallpaperMode
}

type Listener = () => void
const KEY = 'r3os.wallpaper'
const listeners = new Set<Listener>()
const MAX_UINT256 = (1n << 256n) - 1n
const photoListeners = new Set<Listener>()
let lastPhoto: bigint | undefined

function validMode(value: unknown): value is WallpaperMode {
  return value === 'tile' || value === 'center' || value === 'stretch'
}

export function validImageResource(value: unknown): value is ImageResource {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  if (row.kind === 'canvas') return true
  if (row.kind === 'frame') return Number.isSafeInteger(row.tokenId) && Number(row.tokenId) > 0
  if (row.kind === 'photo') {
    if (typeof row.labsId === 'bigint') return row.labsId > 0n && row.labsId <= MAX_UINT256
    if (typeof row.labsId !== 'string' || !/^\d{1,78}$/.test(row.labsId)) return false
    const id = BigInt(row.labsId)
    return id > 0n && id <= MAX_UINT256
  }
  return false
}

function normalizeResource(value: unknown): ImageResource | undefined {
  if (!validImageResource(value)) return undefined
  if (value.kind === 'photo') return { kind: 'photo', labsId: BigInt(value.labsId) }
  // Copy only the known fields so stray keys in storage never travel with the setting.
  if (value.kind === 'frame') return { kind: 'frame', tokenId: value.tokenId }
  return { kind: 'canvas' }
}

export function parseWallpaper(raw: string | null): WallpaperSetting {
  if (!raw) return { mode: 'center' }
  try {
    const parsed = JSON.parse(raw) as { kind?: unknown; tokenId?: unknown; labsId?: unknown; mode?: unknown }
    const mode = validMode(parsed.mode) ? parsed.mode : 'center'
    const resource = normalizeResource(parsed)
    return resource ? { resource, mode } : { mode }
  } catch {
    return { mode: 'center' }
  }
}

function storage() {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function readStored() {
  try {
    return storage()?.getItem(KEY) ?? null
  } catch {
    return null
  }
}

let setting = parseWallpaper(readStored())

export function serializeWallpaper(value: WallpaperSetting) {
  if (!value.resource) return JSON.stringify({ kind: 'none', mode: value.mode })
  const resource =
    value.resource.kind === 'photo'
      ? { kind: 'photo', labsId: value.resource.labsId.toString() }
      : value.resource
  return JSON.stringify({ ...resource, mode: value.mode })
}

export function getWallpaper() {
  return setting
}

export function subscribeWallpaper(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setWallpaper(next: WallpaperSetting) {
  setting = next
  try {
    storage()?.setItem(KEY, serializeWallpaper(next))
  } catch {
    // Wallpaper is a local preference; storage failure only makes it non-persistent.
  }
  for (const listener of listeners) listener()
}

export function applyWallpaperResource(resource: ImageResource, mode: WallpaperMode = setting.mode) {
  const previous = setting
  setWallpaper({ resource, mode })
  pushBalloon({
    id: 'wallpaper-set',
    title: 'Wallpaper set',
    body: resourceLabel(resource),
    actions: [{ label: 'Undo', run: () => setWallpaper(previous) }],
  })
}

export function rememberSessionPhoto(labsId: bigint) {
  lastPhoto = labsId
  for (const listener of photoListeners) listener()
}

export function getSessionPhoto() {
  return lastPhoto
}

export function subscribeSessionPhoto(listener: Listener) {
  photoListeners.add(listener)
  return () => photoListeners.delete(listener)
}

export function pixelImageDataUrl(image: { width: number; height: number; rgba: Uint8ClampedArray }) {
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('image renderer unavailable')
  context.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0)
  return canvas.toDataURL('image/png')
}

export async function wallpaperDataUrl(resource: ImageResource) {
  const loaded = await loadResourcePixels(resource)
  return loaded.kind === 'svg' ? loaded.uri : pixelImageDataUrl(loaded.image)
}
