export interface EncodedFlipRuns {
  runs: Uint8Array
  pixelWrites: number
  runCount: number
  tooManyPixels: boolean
  tooManyRuns: boolean
}

export interface ReelTiming {
  ticks: number[]
  totalMs: number
  startsPerMille: number[]
}

export function packFrame(indices: Uint8Array): Uint8Array {
  if (indices.length !== 1024) throw new Error('flipbook frame must contain 1024 pixels')
  const packed = new Uint8Array(512)
  for (let i = 0; i < 1024; i += 2) {
    const left = indices[i]
    const right = indices[i + 1]
    if (left > 15 || right > 15) throw new Error('flipbook palette indices must be 0..15')
    packed[i >> 1] = (left << 4) | right
  }
  return packed
}

export function unpackFrame(packed: Uint8Array): Uint8Array {
  if (packed.length !== 512) throw new Error('packed flipbook frame must contain 512 bytes')
  const indices = new Uint8Array(1024)
  for (let i = 0; i < packed.length; i++) {
    indices[i * 2] = packed[i] >> 4
    indices[i * 2 + 1] = packed[i] & 0x0f
  }
  return indices
}

export function encodeFlipRuns(base: Uint8Array, working: Uint8Array): EncodedFlipRuns {
  if (base.length !== 1024 || working.length !== 1024)
    throw new Error('flipbook frames must contain 1024 pixels')
  const bytes: number[] = []
  let pixelWrites = 0
  let runCount = 0

  for (let y = 0; y < 32; y++) {
    let x = 0
    while (x < 32) {
      const index = y * 32 + x
      const color = working[index]
      if (color > 15) throw new Error('flipbook palette indices must be 0..15')
      if (base[index] === color) {
        x++
        continue
      }
      const x0 = x
      x++
      while (x < 32) {
        const next = y * 32 + x
        if (working[next] !== color || base[next] === working[next]) break
        x++
      }
      const x1 = x - 1
      bytes.push(y, x0, x1, color)
      pixelWrites += x1 - x0 + 1
      runCount++
    }
  }

  return {
    runs: Uint8Array.from(bytes),
    pixelWrites,
    runCount,
    tooManyPixels: pixelWrites > 64,
    tooManyRuns: runCount > 32,
  }
}

export function applyFlipRuns(indices: Uint8Array, runs: Uint8Array): Uint8Array {
  if (indices.length !== 1024) throw new Error('flipbook frame must contain 1024 pixels')
  if (runs.length === 0 || runs.length % 4 !== 0)
    throw new Error('flipbook runs must be non-empty packed 4-byte tuples')
  const out = indices.slice()
  for (let offset = 0; offset < runs.length; offset += 4) {
    const y = runs[offset]
    const x0 = runs[offset + 1]
    const x1 = runs[offset + 2]
    const color = runs[offset + 3]
    if (y >= 32 || x0 > x1 || x1 >= 32 || color >= 16)
      throw new Error(`invalid flipbook run at ${offset / 4}`)
    for (let x = x0; x <= x1; x++) out[y * 32 + x] = color
  }
  return out
}

export function reelTiming(blocks: bigint[], tickMs: number): ReelTiming {
  if (!Number.isFinite(tickMs) || tickMs <= 0) throw new Error('tickMs must be positive')
  if (blocks.length === 0) return { ticks: [], totalMs: 0, startsPerMille: [] }
  const ticks = new Array<number>(blocks.length)
  let totalTicks = 0
  for (let i = 0; i < blocks.length; i++) {
    let tickCount: number
    if (i === blocks.length - 1) {
      tickCount = 4
    } else {
      const gap = blocks[i + 1] - blocks[i]
      tickCount = Number(gap < 1n ? 1n : gap > 8n ? 8n : gap)
    }
    ticks[i] = tickCount
    totalTicks += tickCount
  }
  const startsPerMille = new Array<number>(blocks.length)
  let elapsed = 0
  for (let i = 0; i < blocks.length; i++) {
    startsPerMille[i] = Math.floor((1000 * elapsed) / totalTicks)
    elapsed += ticks[i]
  }
  return { ticks, totalMs: totalTicks * tickMs, startsPerMille }
}
