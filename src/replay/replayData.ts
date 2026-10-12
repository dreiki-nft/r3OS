/**
 * Season Replay data: a static file of every Painted event of a season (scripts/export-replay.mjs),
 * replayed onto a blank canvas. Pure functions, unit-tested; the program only renders their output.
 */
import { hexToBytes, isHex, type Hex } from 'viem'

export interface ReplayFile {
  version: 1
  chainId: number
  paint: string
  season: number
  fromBlock: string
  toBlock: string
  fromTime: number
  toTime: number
  face: number
  background: number
  outline: Hex
  painters: string[]
  /** [block offset from fromBlock, painter index, runs, corruptions] */
  events: [number, number, Hex, Hex][]
}

export interface ReplayEvent {
  block: number
  painter: number
  runs: Uint8Array
  corruptions: Uint8Array
}

export interface Replay {
  file: ReplayFile
  events: ReplayEvent[]
  outlineMask: Uint8Array
  /** painters seen up to and including event i (painter indices are in order of first appearance) */
  paintersSoFar: Uint16Array
}

const MAX_EVENTS = 500_000
const MAX_PAINTERS = 65_000
const ADDRESS = /^0x[0-9a-f]{40}$/

function fail(reason: string): never {
  throw new Error(`replay file: ${reason}`)
}

/** Strict validation: the file comes from the site, but it is still data, never trusted blindly. */
export function parseReplay(raw: unknown): Replay {
  if (!raw || typeof raw !== 'object') fail('not an object')
  const file = raw as ReplayFile
  if (file.version !== 1) fail('unsupported version')
  for (const key of ['chainId', 'season', 'fromTime', 'toTime', 'face', 'background'] as const) {
    if (!Number.isSafeInteger(file[key]) || file[key] < 0) fail(`bad ${key}`)
  }
  if (file.face > 15 || file.background > 15) fail('bad colour')
  if (!/^\d+$/.test(String(file.fromBlock)) || !/^\d+$/.test(String(file.toBlock))) fail('bad block range')
  if (!isHex(file.outline)) fail('bad outline')
  if (!Array.isArray(file.painters) || file.painters.length > MAX_PAINTERS) fail('bad painters')
  if (file.painters.some((painter) => !ADDRESS.test(painter))) fail('bad painter address')
  if (!Array.isArray(file.events) || file.events.length > MAX_EVENTS) fail('bad events')

  const events: ReplayEvent[] = []
  const paintersSoFar = new Uint16Array(file.events.length)
  let seen = 0
  let lastBlock = 0
  for (let i = 0; i < file.events.length; i++) {
    const row = file.events[i]
    if (!Array.isArray(row) || row.length !== 4) fail(`bad event ${i}`)
    const [block, painter, runs, corruptions] = row
    if (!Number.isSafeInteger(block) || block < lastBlock) fail(`event ${i} out of order`)
    if (!Number.isSafeInteger(painter) || painter < 0 || painter >= file.painters.length)
      fail(`event ${i} painter`)
    if (painter > seen) fail(`event ${i} painter order`)
    if (!isHex(runs) || !isHex(corruptions)) fail(`event ${i} bytes`)
    if (painter === seen) seen += 1
    paintersSoFar[i] = seen
    lastBlock = block
    events.push({ block, painter, runs: hexToBytes(runs), corruptions: hexToBytes(corruptions) })
  }
  return { file, events, outlineMask: outlineMask(hexToBytes(file.outline)), paintersSoFar }
}

/** Outline runs are 3-byte groups (y, x0, x1). */
export function outlineMask(runs: Uint8Array) {
  const mask = new Uint8Array(256 * 256)
  for (let o = 0; o + 2 < runs.length; o += 3) {
    for (let x = runs[o + 1]; x <= runs[o + 2]; x++) mask[runs[o] * 256 + x] = 1
  }
  return mask
}

/** Same rules as the contract's Painted application, but in place (replays touch every event). */
export function applyEventInPlace(pixels: Uint8Array, outline: Uint8Array, event: ReplayEvent) {
  const { runs, corruptions } = event
  for (let o = 0; o + 3 < runs.length; o += 4) {
    const row = runs[o] * 256
    for (let x = runs[o + 1]; x <= runs[o + 2]; x++) {
      if (!outline[row + x]) pixels[row + x] = runs[o + 3]
    }
  }
  for (let o = 0; o + 2 < corruptions.length; o += 3)
    pixels[corruptions[o + 1] * 256 + corruptions[o]] = corruptions[o + 2]
}

export const KEYFRAME_EVERY = 256

/**
 * Rebuilds the canvas after `count` events. Keyframes (every 256 events) make scrubbing cheap: seeking
 * replays at most 255 events from the nearest snapshot instead of the whole season.
 */
export function createCanvasAt(replay: Replay) {
  const keyframes: Uint8Array[] = [new Uint8Array(256 * 256)]
  let built = 0
  let current = new Uint8Array(256 * 256)
  let currentCount = 0

  function ensureKeyframes(upTo: number) {
    while (built + KEYFRAME_EVERY <= upTo) {
      const next = keyframes[keyframes.length - 1].slice()
      for (let i = built; i < built + KEYFRAME_EVERY; i++)
        applyEventInPlace(next, replay.outlineMask, replay.events[i])
      built += KEYFRAME_EVERY
      keyframes.push(next)
    }
  }

  return function canvasAt(count: number) {
    const target = Math.max(0, Math.min(replay.events.length, Math.floor(count)))
    if (target < currentCount || target - currentCount > KEYFRAME_EVERY) {
      ensureKeyframes(target)
      const base = Math.floor(target / KEYFRAME_EVERY)
      current = keyframes[base].slice()
      currentCount = base * KEYFRAME_EVERY
    }
    for (let i = currentCount; i < target; i++)
      applyEventInPlace(current, replay.outlineMask, replay.events[i])
    currentCount = target
    return current
  }
}

/** Event block → unix seconds, interpolated between the two block timestamps the export read. */
export function eventTime(replay: Replay, eventIndex: number) {
  const { file } = replay
  const span = Number(BigInt(file.toBlock) - BigInt(file.fromBlock))
  const event = replay.events[Math.max(0, Math.min(replay.events.length - 1, eventIndex))]
  if (!event || span <= 0) return file.fromTime
  return file.fromTime + ((file.toTime - file.fromTime) * event.block) / span
}

/** How many events have happened by playback fraction t (0..1), on a real-time axis. */
export function eventsAtFraction(replay: Replay, t: number) {
  const span = Number(BigInt(replay.file.toBlock) - BigInt(replay.file.fromBlock))
  const block = Math.max(0, Math.min(1, t)) * span
  let low = 0
  let high = replay.events.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (replay.events[mid].block <= block) low = mid + 1
    else high = mid
  }
  return low
}

export function fractionOfEvent(replay: Replay, count: number) {
  const span = Number(BigInt(replay.file.toBlock) - BigInt(replay.file.fromBlock))
  if (span <= 0 || count <= 0) return 0
  if (count >= replay.events.length) return 1
  return replay.events[count - 1].block / span
}

/**
 * The replay file stops at the block it was exported at; the live canvas keeps going. When the app's own
 * canvas is loaded for the same season and is at least as recent as the file, the replay ends on it, so
 * playback always finishes on the canvas as it is right now.
 */
export function liveCanvasFollows(
  file: Pick<ReplayFile, 'season' | 'toBlock'>,
  live: { season: bigint; snapshotBlock: bigint; status: string },
) {
  return (
    (live.status === 'live' || live.status === 'polling') &&
    live.season === BigInt(file.season) &&
    live.snapshotBlock >= BigInt(file.toBlock)
  )
}

export function formatReplayTime(unixSeconds: number) {
  const date = new Date(unixSeconds * 1_000)
  const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const time = date.toISOString().slice(11, 16)
  return `${day} · ${time} UTC`
}
