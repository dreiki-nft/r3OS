export interface Run {
  y: number
  x0: number
  x1: number
  color: number
}
export interface RegionUsage {
  block: bigint
  pixels: number
}
export interface SplitLimits {
  maxRawPixels: number
  regionCap: number
  currentBlock: bigint
  regionUsage: Map<number, RegionUsage>
  budgetUnits: number
  unitCostAt?: (y: number, x: number) => number
}
export interface PaintChunk {
  runs: Run[]
  pixels: number
  units: number
  regionPixels: Map<number, number>
}
export function bytesToRuns(bytes: Uint8Array) {
  const out: Run[] = []
  for (let o = 0; o + 3 < bytes.length; o += 4)
    out.push({ y: bytes[o], x0: bytes[o + 1], x1: bytes[o + 2], color: bytes[o + 3] })
  return out
}
export function runsToBytes(runs: Run[]) {
  return Uint8Array.from(runs.flatMap((r) => [r.y, r.x0, r.x1, r.color]))
}
function region(y: number, x: number) {
  return (y >> 6) * 4 + (x >> 6)
}
export function splitPaintRuns(input: Run[], limits: SplitLimits) {
  const queue: Run[] = []
  for (const run of input) {
    let x = run.x0
    while (x <= run.x1) {
      const r = region(run.y, x)
      const boundary = Math.min(run.x1, ((r & 3) + 1) * 64 - 1)
      queue.push({ ...run, x0: x, x1: boundary })
      x = boundary + 1
    }
  }
  queue.sort((a, b) => region(a.y, a.x0) - region(b.y, b.x0) || a.y - b.y || a.x0 - b.x0)
  const chunks: PaintChunk[] = []
  let current: PaintChunk = { runs: [], pixels: 0, units: 0, regionPixels: new Map() }
  let totalUnits = 0
  const advancedRegions = new Set<number>()
  const flush = () => {
    if (current.runs.length) {
      for (const r of current.regionPixels.keys()) advancedRegions.add(r)
      chunks.push(current)
      totalUnits += current.units
      current = { runs: [], pixels: 0, units: 0, regionPixels: new Map() }
    }
  }
  const unit = (y: number, x: number) => Math.max(1, limits.unitCostAt?.(y, x) ?? 1)
  for (const seg of queue) {
    let x = seg.x0
    while (x <= seg.x1) {
      const reg = region(seg.y, x)
      const used = limits.regionUsage.get(reg)
      const capBase = !advancedRegions.has(reg) && used?.block === limits.currentBlock ? used.pixels : 0
      const inChunk = current.regionPixels.get(reg) ?? 0
      const rawLeft = limits.maxRawPixels - current.pixels
      const regionLeft = limits.regionCap - capBase - inChunk
      const budgetLeft = limits.budgetUnits - totalUnits - current.units
      if (rawLeft <= 0 || regionLeft <= 0 || budgetLeft <= 0) {
        if (current.runs.length) {
          flush()
          continue
        }
        if (budgetLeft <= 0) return chunks
        if (regionLeft <= 0) {
          advancedRegions.add(reg)
          continue
        }
        return chunks
      }
      let take = 0,
        units = 0
      const maxPixels = Math.min(seg.x1 - x + 1, rawLeft, regionLeft)
      while (take < maxPixels) {
        const u = unit(seg.y, x + take)
        if (units + u > budgetLeft) break
        units += u
        take++
      }
      if (take === 0) {
        flush()
        continue
      }
      current.runs.push({ ...seg, x0: x, x1: x + take - 1 })
      current.pixels += take
      current.units += units
      current.regionPixels.set(reg, inChunk + take)
      x += take
      if (current.pixels >= limits.maxRawPixels || current.units >= limits.budgetUnits - totalUnits) flush()
    }
  }
  flush()
  return chunks
}
