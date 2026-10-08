/**
 * Pure helpers for the broadcast view (#/tv): the screen you put on a wall at a paint party. Everything
 * here comes from the core contract's own `Painted` / `FrameMinted` events via the canvas store; there is no
 * server and nothing in the URL is ever shown on screen.
 */
import { hexToBytes, type Hex } from 'viem'
import { PALETTE } from '../lib/palette'
import { strokeFromRuns, strokeKey, type Box } from '../paint/presence'
import type { CanvasActivity } from '../paint/canvasStore'

export interface TvStroke {
  key: string
  owner: string
  block: bigint
  pixels: number
  box: Box
  /** palette index this stroke used most (falls back to a colour picked from the address) */
  colour: number
  /** when this browser saw it; flashes are only drawn for live strokes */
  seenAt: number
  live: boolean
}

export interface TvFrame {
  key: string
  minter: string
  tokenId: bigint
  block: bigint
  seenAt: number
}

/** The broadcast view's route. Exact match only: nothing after it is read or shown. */
export function isTvRoute(hash: string) {
  return /^#\/tv\/?$/.test(hash)
}

/** "On air" strokes worth flashing; older ones only appear in the feed. */
export const FLASH_MS = 4_000
export const MAX_TV_STROKES = 2_000
export const PROMPT_MS = 5 * 60_000

/** Colours that read on a black screen (no white, background, or black). */
const SHOWABLE = PALETTE.filter((entry) => ![0, 1, 7].includes(entry.index)).map((entry) => entry.index)

/** A stable colour for a wallet, used when we only know the stroke's shape (look-back strokes). */
export function painterColour(address: string) {
  let hash = 0
  for (const char of address.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return SHOWABLE[hash % SHOWABLE.length]
}

/** The palette index a `runs` payload painted the most pixels with (4-byte groups: y, x0, x1, colour). */
export function dominantColour(runs: Uint8Array): number | undefined {
  const counts = new Map<number, number>()
  for (let offset = 0; offset + 3 < runs.length; offset += 4) {
    const start = runs[offset + 1]
    const end = runs[offset + 2]
    const colour = runs[offset + 3] & 15
    if (end < start) continue
    counts.set(colour, (counts.get(colour) ?? 0) + end - start + 1)
  }
  let best: number | undefined
  let bestCount = -1
  for (const [colour, count] of counts) {
    if (count > bestCount) {
      best = colour
      bestCount = count
    }
  }
  return best
}

/** Colour to draw a stroke's flash in: what they painted, unless that is invisible on black. */
export function flashColour(colour: number | undefined, owner: string) {
  return colour == null || !SHOWABLE.includes(colour) ? painterColour(owner) : colour
}

export function tvStrokeFromActivity(activity: CanvasActivity, now: number): TvStroke | undefined {
  if (activity.eventName !== 'Painted' || !activity.runs || !activity.owner) return undefined
  const runs = hexToBytes(activity.runs as Hex)
  const shape = strokeFromRuns(runs)
  if (!shape) return undefined
  const owner = activity.owner.toLowerCase()
  return {
    key: strokeKey(activity),
    owner,
    block: activity.blockNumber,
    pixels: shape.pixels,
    box: shape.box,
    colour: flashColour(dominantColour(runs), owner),
    seenAt: now,
    live: true,
  }
}

export function tvFrameFromActivity(activity: CanvasActivity, now: number): TvFrame | undefined {
  if (activity.eventName !== 'FrameMinted' || !activity.minter || activity.tokenId == null) return undefined
  return {
    key: strokeKey(activity),
    minter: activity.minter.toLowerCase(),
    tokenId: activity.tokenId,
    block: activity.blockNumber,
    seenAt: now,
  }
}

/** Newest first, one row per event (a stroke can arrive as a proposal and again when finalized). */
export function mergeTvStrokes(
  current: readonly TvStroke[],
  incoming: readonly TvStroke[],
  max = MAX_TV_STROKES,
) {
  const byKey = new Map<string, TvStroke>()
  for (const stroke of current) byKey.set(stroke.key, stroke)
  for (const stroke of incoming) {
    // A live sighting is kept as it was first seen: a re-delivered event (proposal, then finalized) doesn't
    // flash twice, and a late look-back copy can't downgrade it. A look-back row is replaced by a live one.
    if (byKey.get(stroke.key)?.live) continue
    byKey.set(stroke.key, stroke)
  }
  return [...byKey.values()]
    .sort((a, b) => (a.block === b.block ? b.seenAt - a.seenAt : a.block > b.block ? -1 : 1))
    .slice(0, max)
}

/** Totals since the screen went on air (the look-back strokes count too). */
export function partyStats(strokes: readonly TvStroke[], frames: readonly TvFrame[]) {
  const painters = new Set<string>()
  let pixels = 0
  for (const stroke of strokes) {
    painters.add(stroke.owner)
    pixels += stroke.pixels
  }
  return { painters: painters.size, pixels, paints: strokes.length, frames: frames.length }
}

/** Top painters by pixels, for the leaderboard. Ties go to whoever painted first. */
export function topPainters(strokes: readonly TvStroke[], limit = 5) {
  const rows = new Map<
    string,
    { owner: string; pixels: number; paints: number; colour: number; first: bigint }
  >()
  for (const stroke of strokes) {
    const row = rows.get(stroke.owner) ?? {
      owner: stroke.owner,
      pixels: 0,
      paints: 0,
      // strokes arrive newest first, so this is the colour they painted with most recently
      colour: stroke.colour,
      first: stroke.block,
    }
    row.pixels += stroke.pixels
    row.paints += 1
    if (stroke.block < row.first) row.first = stroke.block
    rows.set(stroke.owner, row)
  }
  return [...rows.values()]
    .sort((a, b) => b.pixels - a.pixels || (a.first < b.first ? -1 : a.first > b.first ? 1 : 0))
    .slice(0, limit)
}

/** Which prompt is on screen: rotates every PROMPT_MS, shifted by the host's ←/→ presses. */
export function promptIndex(elapsedMs: number, shift: number, count: number, periodMs = PROMPT_MS) {
  if (count <= 0) return 0
  const step = Math.floor(Math.max(0, elapsedMs) / periodMs) + shift
  return ((step % count) + count) % count
}

/** 0..1 through the current prompt. */
export function promptProgress(elapsedMs: number, periodMs = PROMPT_MS) {
  return (Math.max(0, elapsedMs) % periodMs) / periodMs
}

/** "4 min", "1 h 12 min" */
export function onAirLabel(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

/** Flash positions as percentages of the canvas, so the overlay scales with the screen. */
export function boxPercent(box: Box) {
  return {
    left: (box.x0 / 256) * 100,
    top: (box.y0 / 256) * 100,
    width: ((box.x1 - box.x0 + 1) / 256) * 100,
    height: ((box.y1 - box.y0 + 1) / 256) * 100,
  }
}
