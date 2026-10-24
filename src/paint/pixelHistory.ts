/**
 * "Who painted here?": for every pixel, the last wallet that changed it, when, and how many times it changed
 * hands. Built once, on request, from the published Season Replay (public/replay/season-N.json, every Painted
 * event up to the last refresh) and kept current with the live Painted events this tab receives afterwards.
 * Nothing new is read from the chain for it, and the 1 MB replay is only fetched when someone asks.
 */
import { hexToBytes, type Hex } from 'viem'
import { parseReplay, type Replay } from '../replay/replayData'
import { subscribeCanvasActivity } from './canvasStore'

export type PixelHistory = {
  painters: string[]
  /** index into painters of the last wallet that changed the pixel, -1 = never painted */
  who: Int32Array
  block: Float64Array
  changes: Uint16Array
  /** 1 when the last change was a DF1 glitch caused by that wallet's paint */
  glitch: Uint8Array
  colour: Uint8Array
  outline: Uint8Array
  toBlock: number
}

export type PixelInfo =
  { painted: false } | { painted: true; address: string; block: number; changes: number; glitch: boolean }

function painterIndex(history: PixelHistory, address: string) {
  const lower = address.toLowerCase()
  let index = history.painters.indexOf(lower)
  if (index < 0) index = history.painters.push(lower) - 1
  return index
}

function write(h: PixelHistory, i: number, colour: number, who: number, block: number, glitch: boolean) {
  if (h.colour[i] === colour) return
  h.colour[i] = colour
  h.who[i] = who
  h.block[i] = block
  h.glitch[i] = glitch ? 1 : 0
  if (h.changes[i] < 65_535) h.changes[i] += 1
}

/** Apply one Painted event: its runs (skipping the protected outline), then its DF1 corruptions. */
export function applyPaint(
  h: PixelHistory,
  who: number,
  block: number,
  runs: Uint8Array,
  corruptions: Uint8Array = new Uint8Array(),
) {
  for (let o = 0; o + 3 < runs.length; o += 4) {
    const row = runs[o] * 256
    for (let x = runs[o + 1]; x <= runs[o + 2]; x++)
      if (!h.outline[row + x]) write(h, row + x, runs[o + 3], who, block, false)
  }
  for (let o = 0; o + 2 < corruptions.length; o += 3)
    write(h, corruptions[o + 1] * 256 + corruptions[o], corruptions[o + 2], who, block, true)
}

export function buildPixelHistory(replay: Replay): PixelHistory {
  const from = Number(replay.file.fromBlock)
  const h: PixelHistory = {
    painters: replay.file.painters.map((painter) => painter.toLowerCase()),
    who: new Int32Array(65_536).fill(-1),
    block: new Float64Array(65_536),
    changes: new Uint16Array(65_536),
    glitch: new Uint8Array(65_536),
    colour: new Uint8Array(65_536),
    outline: replay.outlineMask,
    toBlock: Number(replay.file.toBlock),
  }
  for (const event of replay.events)
    applyPaint(h, event.painter, from + event.block, event.runs, event.corruptions)
  return h
}

export function pixelInfo(h: PixelHistory, x: number, y: number): PixelInfo {
  const i = y * 256 + x
  if (x < 0 || y < 0 || x > 255 || y > 255 || h.who[i] < 0) return { painted: false }
  return {
    painted: true,
    address: h.painters[h.who[i]],
    block: h.block[i],
    changes: h.changes[i],
    glitch: h.glitch[i] === 1,
  }
}

// ─── loading, on request ─────────────────────────────────────────────────────
type State = { status: 'idle' | 'loading' | 'error' } | { status: 'ready'; history: PixelHistory }
let state: State = { status: 'idle' }
let version = 0
const listeners = new Set<() => void>()
const emit = () => {
  version++
  for (const listener of listeners) listener()
}

export function getPixelHistory() {
  return state
}
export function getPixelHistoryVersion() {
  return version
}
export function subscribePixelHistory(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function loadPixelHistory(season: number) {
  if (state.status === 'loading' || state.status === 'ready') return
  state = { status: 'loading' }
  emit()
  void fetch(`/replay/season-${season}.json`, { cache: 'no-cache' })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
    .then((json) => {
      const history = buildPixelHistory(parseReplay(json))
      state = { status: 'ready', history }
      // Paints since the replay was published, as this tab receives them.
      subscribeCanvasActivity((activity) => {
        if (activity.eventName !== 'Painted' || !activity.owner || !activity.runs) return
        const block = Number(activity.blockNumber)
        if (block <= history.toBlock) return
        applyPaint(history, painterIndex(history, activity.owner), block, hexToBytes(activity.runs as Hex))
        emit()
      })
      emit()
    })
    .catch(() => {
      state = { status: 'error' }
      emit()
    })
}

export function __setPixelHistoryForTests(history?: PixelHistory) {
  state = history ? { status: 'ready', history } : { status: 'idle' }
}
