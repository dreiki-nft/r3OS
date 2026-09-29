import { hexToBytes, type Address, type Hex } from 'viem'

export const PAGE_SLOTS = 128
export const CANVAS_SLOTS = 1_024
export const CANVAS_PAGES = 8
export const REGION_PAGES = 16
export const OUTLINE_PAGES = 8
export const DRIVE_C_PAGES = CANVAS_PAGES + REGION_PAGES + OUTLINE_PAGES
export const FLIPBOOK_FRAME_WORDS = 16
export const FLIPBOOK_RING_FRAMES = 32
export const FLIPBOOK_SLOTS = FLIPBOOK_FRAME_WORDS * FLIPBOOK_RING_FRAMES
export const FLIPBOOK_PAGES = FLIPBOOK_SLOTS / PAGE_SLOTS
export const BRUSH_BOX_SLOTS_USED = 9

export type DefragDrive = 'C' | 'D' | 'E'
export type TouchMode = 'read' | 'write'

export type SlotTouch = {
  drive: DefragDrive
  page: number
  slot: number
  mode: TouchMode
  blockNumber: bigint
  owner?: Address
}

export type DefragAnimation = {
  phase: 'idle' | 'reading' | 'moving' | 'complete' | 'paused' | 'stopped'
  progress: number
}

function uniqueTouches(touches: readonly SlotTouch[]) {
  const map = new Map<string, SlotTouch>()
  for (const touch of touches) {
    const key = `${touch.drive}:${touch.page}:${touch.slot}:${touch.mode}`
    map.set(key, touch)
  }
  return [...map.values()]
}

export function canvasSlot(x: number, y: number) {
  return y * 4 + (x >> 6)
}

export function canvasPage(x: number, y: number) {
  return Math.floor(canvasSlot(x, y) / PAGE_SLOTS)
}

function regionFor(x: number, y: number) {
  return (y >> 6) * 4 + (x >> 6)
}

function localTileFor(x: number, y: number) {
  const tileRow = y >> 4
  const tileCol = x >> 4
  return (tileRow & 3) * 4 + (tileCol & 3)
}

export function decodePaintRuns(runs: Hex) {
  const bytes = hexToBytes(runs)
  const out: { y: number; x0: number; x1: number; colour: number }[] = []
  for (let offset = 0; offset + 3 < bytes.length; offset += 4) {
    out.push({ y: bytes[offset], x0: bytes[offset + 1], x1: bytes[offset + 2], colour: bytes[offset + 3] })
  }
  return out
}

export function paintStorageTouches(runs: Hex, blockNumber: bigint): SlotTouch[] {
  const touches: SlotTouch[] = []
  const regions = new Set<number>()
  const tiles = new Set<string>()

  for (const run of decodePaintRuns(runs)) {
    const firstWord = run.x0 >> 6
    const lastWord = run.x1 >> 6
    for (let word = firstWord; word <= lastWord; word++) {
      const slot = run.y * 4 + word
      touches.push({ drive: 'C', page: Math.floor(slot / PAGE_SLOTS), slot, mode: 'write', blockNumber })
      touches.push({
        drive: 'C',
        page: CANVAS_PAGES + REGION_PAGES + Math.floor(slot / PAGE_SLOTS),
        slot: (CANVAS_PAGES + REGION_PAGES) * PAGE_SLOTS + slot,
        mode: 'read',
        blockNumber,
      })
    }

    const firstTileColumn = run.x0 >> 4
    const lastTileColumn = run.x1 >> 4
    for (let tileColumn = firstTileColumn; tileColumn <= lastTileColumn; tileColumn++) {
      const sampleX = tileColumn << 4
      const region = regionFor(sampleX, run.y)
      regions.add(region)
      tiles.add(`${region}:${localTileFor(sampleX, run.y)}`)
    }
  }

  for (const key of tiles) {
    const [regionText, tileText] = key.split(':')
    const region = Number(regionText)
    const tile = Number(tileText)
    const base = (CANVAS_PAGES + region) * PAGE_SLOTS
    for (const offset of [tile, 16 + tile, 32 + tile]) {
      touches.push({
        drive: 'C',
        page: CANVAS_PAGES + region,
        slot: base + offset,
        mode: 'write',
        blockNumber,
      })
    }
  }

  for (const region of regions) {
    const base = (CANVAS_PAGES + region) * PAGE_SLOTS
    for (const offset of [48, 49, 50 + Number(blockNumber % 10n), 60]) {
      touches.push({
        drive: 'C',
        page: CANVAS_PAGES + region,
        slot: base + offset,
        mode: 'write',
        blockNumber,
      })
    }
  }

  return uniqueTouches(touches)
}

export function flipbookStorageTouches(frameNumber: bigint, blockNumber: bigint): SlotTouch[] {
  const frame = Number(frameNumber % BigInt(FLIPBOOK_RING_FRAMES))
  const first = frame * FLIPBOOK_FRAME_WORDS
  return Array.from({ length: FLIPBOOK_FRAME_WORDS }, (_, index) => {
    const slot = first + index
    return {
      drive: 'D' as const,
      page: Math.floor(slot / PAGE_SLOTS),
      slot,
      mode: 'write' as const,
      blockNumber,
    }
  })
}

export function brushStorageTouches(owner: Address, boxIndex: number, blockNumber: bigint): SlotTouch[] {
  const base = boxIndex * PAGE_SLOTS
  return [
    { drive: 'E', page: boxIndex, slot: base, mode: 'write', blockNumber, owner },
    { drive: 'E', page: boxIndex, slot: base + 8, mode: 'write', blockNumber, owner },
  ]
}

export function countColdWarm(touches: readonly SlotTouch[]) {
  const pages = new Set<string>()
  let cold = 0
  let warm = 0
  for (const touch of touches) {
    const page = `${touch.drive}:${touch.page}`
    if (pages.has(page)) warm++
    else {
      pages.add(page)
      cold++
    }
  }
  return { cold, warm, total: cold + warm, pages: pages.size }
}

export function samePageShare(blocks: readonly (readonly SlotTouch[])[]) {
  let warm = 0
  let total = 0
  for (const touches of blocks) {
    const stats = countColdWarm(touches)
    warm += stats.warm
    total += stats.total
  }
  return total ? warm / total : 0
}

export function startDefrag(): DefragAnimation {
  return { phase: 'reading', progress: 0 }
}

export function advanceDefrag(state: DefragAnimation): DefragAnimation {
  if (state.phase === 'paused' || state.phase === 'complete' || state.phase === 'stopped') return state
  if (state.phase === 'idle') return startDefrag()
  const next = Math.min(100, state.progress + (state.phase === 'reading' ? 10 : 8))
  if (state.phase === 'reading') return { phase: next >= 20 ? 'moving' : 'reading', progress: next }
  if (next >= 100) return { phase: 'complete', progress: 100 }
  return { phase: 'moving', progress: next }
}

export function pauseDefrag(state: DefragAnimation): DefragAnimation {
  return state.phase === 'reading' || state.phase === 'moving' ? { ...state, phase: 'paused' } : state
}

export function resumeDefrag(state: DefragAnimation): DefragAnimation {
  return state.phase === 'paused' ? { ...state, phase: state.progress < 20 ? 'reading' : 'moving' } : state
}

export function stopDefrag(state: DefragAnimation): DefragAnimation {
  return state.phase === 'complete' ? state : { phase: 'stopped', progress: state.progress }
}

export function completionMessage(drive: DefragDrive, pages: number) {
  const alignment =
    drive === 'C'
      ? 'This canvas was already page-aligned on day 1: every 32 rows share one 4 KB page.'
      : 'This data was already page-aligned on day 1.'
  return `Defragmentation of drive ${drive} is complete. ${alignment} ${pages} pages shown.`
}
