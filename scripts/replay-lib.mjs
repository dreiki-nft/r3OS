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
 */
export function replayFrames(replay, frameCount) {
  const outline = new Uint8Array(256 * 256)
  const runs = bytes(replay.outline)
  for (let o = 0; o + 2 < runs.length; o += 3)
    for (let x = runs[o + 1]; x <= runs[o + 2]; x++) outline[runs[o] * 256 + x] = 1
  const pixels = new Uint8Array(256 * 256)
  const frames = []
  let applied = 0
  for (let f = 1; f <= frameCount; f++) {
    const target = Math.round((f / frameCount) * replay.events.length)
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
