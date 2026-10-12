// Pure helpers for scripts/export-replay.mjs and scripts/replay-gif.mjs (unit-tested; no network here).
import { readFileSync } from 'node:fs'
import { decodeEventLog } from 'viem'
import { PAINTED } from './community-stats-lib.mjs'

export const REPLAY_VERSION = 1

/** The default season outline as committed in the generated source (used when a season has no custom outline). */
export function defaultOutlineHex(path = new URL('../src/lib/generated/outline.ts', import.meta.url)) {
  const match = readFileSync(path, 'utf8').match(/OUTLINE_RUNS_HEX = '(0x[0-9a-f]+)'/)
  if (!match) throw new Error('default outline not found in src/lib/generated/outline.ts')
  return match[1]
}

/** RGB triples of the 16-colour palette, read from src/lib/palette.ts so there is one source of truth. */
export function paletteRgb(path = new URL('../src/lib/palette.ts', import.meta.url)) {
  const rows = [...readFileSync(path, 'utf8').matchAll(/index: (\d+),[^\n]*rgb: \[(\d+), (\d+), (\d+)\]/g)]
  const out = []
  for (const row of rows) out[Number(row[1])] = [Number(row[2]), Number(row[3]), Number(row[4])]
  if (out.length !== 16 || out.some((rgb) => !rgb)) throw new Error('palette must have 16 entries')
  return out
}

/**
 * Painted logs → a compact, deterministic replay. Events are ordered by (block, log index) and keep
 * the exact runs and DF1 corruptions the contract emitted, so the replay rebuilds the real canvas.
 */
export function buildReplay(logs, meta) {
  const painters = []
  const painterIndex = new Map()
  const rows = []
  for (const log of logs) {
    let args
    try {
      args = decodeEventLog({ abi: [PAINTED], data: log.data, topics: log.topics }).args
    } catch {
      continue
    }
    if (BigInt(args.season) !== BigInt(meta.season)) continue
    const owner = String(args.owner).toLowerCase()
    if (!painterIndex.has(owner)) {
      painterIndex.set(owner, painters.length)
      painters.push(owner)
    }
    rows.push({
      block: BigInt(log.blockNumber),
      logIndex: Number(log.logIndex ?? 0),
      painter: painterIndex.get(owner),
      runs: String(args.runs).toLowerCase(),
      corruptions: String(args.corruptions).toLowerCase(),
    })
  }
  rows.sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1))
  // Painter indices follow first appearance in time, so "painters so far" is a simple running max.
  const remap = new Map()
  const ordered = []
  for (const row of rows) {
    if (!remap.has(row.painter)) {
      remap.set(row.painter, ordered.length)
      ordered.push(painters[row.painter])
    }
  }
  const fromBlock = BigInt(meta.fromBlock)
  return {
    version: REPLAY_VERSION,
    chainId: Number(meta.chainId),
    paint: String(meta.paint).toLowerCase(),
    season: Number(meta.season),
    fromBlock: String(fromBlock),
    toBlock: String(meta.toBlock),
    fromTime: Number(meta.fromTime),
    toTime: Number(meta.toTime),
    face: Number(meta.face),
    background: Number(meta.background),
    outline: String(meta.outline).toLowerCase(),
    painters: ordered,
    events: rows.map((row) => [
      Number(row.block - fromBlock),
      remap.get(row.painter),
      row.runs,
      row.corruptions,
    ]),
  }
}

/**
 * Appends a later export to an existing replay, so refreshing it only scans the new blocks. Both must be
 * the same chain, contract, season and starting block (the tail is built with the existing fromBlock, so
 * event offsets line up). Painters new in the tail are added in order of first appearance.
 */
export function appendReplay(existing, tail) {
  for (const key of ['version', 'chainId', 'paint', 'season', 'fromBlock', 'outline'])
    if (String(existing[key]) !== String(tail[key])) throw new Error(`can't append: ${key} differs`)
  if (BigInt(tail.toBlock) <= BigInt(existing.toBlock)) return existing
  const painters = existing.painters.slice()
  const index = new Map(painters.map((painter, i) => [painter, i]))
  const events = existing.events.slice()
  const firstNew = Number(BigInt(existing.toBlock) - BigInt(existing.fromBlock)) + 1
  for (const [offset, painter, runs, corruptions] of tail.events) {
    if (offset < firstNew) throw new Error("can't append: the new events overlap the old ones")
    const address = tail.painters[painter]
    if (!index.has(address)) {
      index.set(address, painters.length)
      painters.push(address)
    }
    events.push([offset, index.get(address), runs, corruptions])
  }
  return {
    ...existing,
    toBlock: tail.toBlock,
    toTime: tail.toTime,
    face: tail.face,
    background: tail.background,
    painters,
    events,
  }
}

/** Contract rules for one Painted event, in place: runs skip the outline, DF1 corruptions (x, y, c) land anyway. */
export function applyEvent(pixels, outline, runs, corruptions) {
  for (let o = 0; o + 3 < runs.length; o += 4) {
    const row = runs[o] * 256
    for (let x = runs[o + 1]; x <= runs[o + 2]; x++) if (!outline[row + x]) pixels[row + x] = runs[o + 3]
  }
  for (let o = 0; o + 2 < corruptions.length; o += 3)
    pixels[corruptions[o + 1] * 256 + corruptions[o]] = corruptions[o + 2]
}

const bytes = (hex) => Uint8Array.from(Buffer.from(hex.slice(2), 'hex'))

/**
 * Palette-index frames of the replay (outline drawn in the face colour, blank pixels in the background
 * colour), sampled evenly by stroke count. The last frame is the canvas after every event.
 * `window` ({ fromBlock, toBlock }, absolute block numbers) animates only the strokes in that range: the
 * first frame already shows everything painted before it (e.g. the canvas at launch).
 */
export function replayFrames(replay, frameCount, window) {
  const outline = new Uint8Array(256 * 256)
  const runs = bytes(replay.outline)
  for (let o = 0; o + 2 < runs.length; o += 3)
    for (let x = runs[o + 1]; x <= runs[o + 2]; x++) outline[runs[o] * 256 + x] = 1
  const pixels = new Uint8Array(256 * 256)
  const frames = []
  const base = BigInt(replay.fromBlock)
  const blockOf = (event) => base + BigInt(event[0])
  let applied = 0
  let end = replay.events.length
  if (window) {
    const from = window.fromBlock == null ? undefined : BigInt(window.fromBlock)
    const to = window.toBlock == null ? undefined : BigInt(window.toBlock)
    if (from != null)
      for (; applied < replay.events.length && blockOf(replay.events[applied]) < from; applied++) {
        const [, , eventRuns, corruptions] = replay.events[applied]
        applyEvent(pixels, outline, bytes(eventRuns), bytes(corruptions))
      }
    if (to != null) while (end > applied && blockOf(replay.events[end - 1]) > to) end--
  }
  const start = applied
  for (let f = 1; f <= frameCount; f++) {
    // A window opens on the canvas as it stood at its start; a whole season opens after its first strokes.
    const progress = window ? (f - 1) / Math.max(1, frameCount - 1) : f / frameCount
    const target = start + Math.round(progress * (end - start))
    for (; applied < target; applied++) {
      const [, , eventRuns, corruptions] = replay.events[applied]
      applyEvent(pixels, outline, bytes(eventRuns), bytes(corruptions))
    }
    const frame = new Uint8Array(256 * 256)
    for (let i = 0; i < frame.length; i++)
      frame[i] = outline[i] ? replay.face : pixels[i] === 0 ? replay.background : pixels[i]
    frames.push(frame)
  }
  return frames
}
