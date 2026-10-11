/**
 * The unsent drawing, kept in this browser so it survives a reload. On a phone, connecting MetaMask opens the
 * MetaMask app and Android often reloads the tab when you come back, and the drawing (which lived only in the
 * page's memory) was gone. Only the changed pixels are stored, as index/colour triples.
 */
export type DraftPixel = readonly [index: number, colour: number]

export function draftPixels(background: Uint8Array, working: Uint8Array): DraftPixel[] {
  const pixels: DraftPixel[] = []
  for (let index = 0; index < working.length; index++) {
    if (working[index] !== background[index]) pixels.push([index, working[index]])
  }
  return pixels
}

export function encodeDraft(pixels: readonly DraftPixel[]) {
  const bytes = new Uint8Array(pixels.length * 3)
  pixels.forEach(([index, colour], i) => {
    bytes[i * 3] = index >> 8
    bytes[i * 3 + 1] = index & 0xff
    bytes[i * 3 + 2] = colour
  })
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export function decodeDraft(encoded: string): DraftPixel[] {
  const binary = atob(encoded)
  const pixels: DraftPixel[] = []
  for (let i = 0; i + 2 < binary.length; i += 3) {
    const index = (binary.charCodeAt(i) << 8) | binary.charCodeAt(i + 1)
    const colour = binary.charCodeAt(i + 2)
    if (colour < 16) pixels.push([index, colour])
  }
  return pixels
}

/** Puts a stored drawing back on top of the canvas, skipping protected outline pixels. */
export function applyDraft(background: Uint8Array, outline: Uint8Array, pixels: readonly DraftPixel[]) {
  const working = background.slice()
  for (const [index, colour] of pixels) {
    if (index >= 0 && index < working.length && !outline[index]) working[index] = colour
  }
  return working
}

type StoredDraft = { season: string; pixels: string; savedAt: number }
const DRAFT_TTL_MS = 3 * 24 * 60 * 60 * 1_000

export function saveDraft(key: string, season: bigint, background: Uint8Array, working: Uint8Array) {
  try {
    const pixels = draftPixels(background, working)
    if (!pixels.length) localStorage.removeItem(key)
    else
      localStorage.setItem(
        key,
        JSON.stringify({
          season: season.toString(),
          pixels: encodeDraft(pixels),
          savedAt: Date.now(),
        } satisfies StoredDraft),
      )
  } catch {
    // Storage full or blocked: the drawing just isn't kept across reloads.
  }
}

export function loadDraft(key: string, season: bigint): DraftPixel[] | undefined {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return undefined
    const stored = JSON.parse(raw) as Partial<StoredDraft>
    // A draft from another season, or an old one, no longer fits the canvas.
    if (
      stored.season !== season.toString() ||
      !stored.pixels ||
      Date.now() - (stored.savedAt ?? 0) > DRAFT_TTL_MS
    ) {
      localStorage.removeItem(key)
      return undefined
    }
    return decodeDraft(stored.pixels)
  } catch {
    return undefined
  }
}
