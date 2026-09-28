import { toHex, type Hex } from 'viem'

export interface ForkRun {
  y: number
  x0: number
  x1: number
  colour: number
}

export function forkRowsToIndices(rows: readonly bigint[]): Uint8Array {
  if (rows.length !== 64) throw new Error('rows must contain 64 words')
  const out = new Uint8Array(64 * 64)
  for (let y = 0; y < 64; y++) {
    const row = rows[y]
    for (let x = 0; x < 64; x++) {
      out[y * 64 + x] = Number((row >> BigInt(252 - 4 * x)) & 0xfn)
    }
  }
  return out
}

export function indicesToForkRows(indices: Uint8Array): bigint[] {
  if (indices.length !== 64 * 64) throw new Error('indices must contain 4096 pixels')
  const rows = Array<bigint>(64).fill(0n)
  for (let y = 0; y < 64; y++) {
    let row = 0n
    for (let x = 0; x < 64; x++) {
      const value = indices[y * 64 + x]
      if (value > 15) throw new Error('indices must be palette values 0..15')
      row |= BigInt(value) << BigInt(252 - 4 * x)
    }
    rows[y] = row
  }
  return rows
}

export function encodeForkRuns(runs: ForkRun[]): Hex {
  if (runs.length === 0 || runs.length > 32) throw new Error('InvalidRuns')
  let pixels = 0
  runs.forEach((run) => {
    const ints = [run.y, run.x0, run.x1, run.colour]
    if (ints.some((value) => !Number.isInteger(value))) throw new Error('InvalidRuns')
    if (
      run.y < 0 ||
      run.y >= 64 ||
      run.x0 < 0 ||
      run.x0 >= 64 ||
      run.x1 < 0 ||
      run.x1 >= 64 ||
      run.x0 > run.x1 ||
      run.colour < 0 ||
      run.colour >= 16
    )
      throw new Error('InvalidRuns')
    pixels += run.x1 - run.x0 + 1
  })
  if (pixels > 64) throw new Error(`TooManyPixels(${pixels})`)

  // Stable sort: equal-row runs preserve caller order, so later overlapping runs still win.
  const sorted = runs
    .map((run, order) => ({ run, order }))
    .sort((a, b) => a.run.y - b.run.y || a.order - b.order)
  const out = new Uint8Array(sorted.length * 4)
  sorted.forEach(({ run }, i) => {
    out[i * 4] = run.y
    out[i * 4 + 1] = run.x0
    out[i * 4 + 2] = run.x1
    out[i * 4 + 3] = run.colour
  })
  return toHex(out)
}

export function encodeForkDiff(
  base: Uint8Array,
  working: Uint8Array,
): { hex: Hex; pixels: number; runs: number; tooManyPixels: boolean; tooManyRuns: boolean } {
  if (base.length !== 4096 || working.length !== 4096) throw new Error('fork images must contain 4096 pixels')
  const parts: ForkRun[] = []
  let pixels = 0
  for (let y = 0; y < 64; y++) {
    let x = 0
    while (x < 64) {
      const index = y * 64 + x
      const colour = working[index]
      if (colour > 15) throw new Error('indices must be palette values 0..15')
      if (base[index] === colour) {
        x++
        continue
      }
      const x0 = x++
      while (x < 64) {
        const next = y * 64 + x
        if (working[next] !== colour || base[next] === working[next]) break
        x++
      }
      const x1 = x - 1
      parts.push({ y, x0, x1, colour })
      pixels += x1 - x0 + 1
    }
  }
  const tooManyPixels = pixels > 64
  const tooManyRuns = parts.length > 32
  return {
    hex: parts.length && !tooManyPixels && !tooManyRuns ? encodeForkRuns(parts) : '0x',
    pixels,
    runs: parts.length,
    tooManyPixels,
    tooManyRuns,
  }
}
