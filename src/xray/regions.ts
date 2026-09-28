import { hexToBytes, type Hex } from 'viem'
import type { Run } from '../paint/split'

function addRunRegions(regions: Set<number>, y: number, x0: number, x1: number) {
  const left = x0 >> 6
  const right = x1 >> 6
  for (let column = left; column <= right; column++) regions.add((y >> 6) * 4 + column)
}

export function regionsFromRuns(value: Uint8Array | Hex) {
  const runs = typeof value === 'string' ? new Uint8Array(hexToBytes(value)) : value
  const regions = new Set<number>()
  for (let offset = 0; offset + 3 < runs.length; offset += 4) {
    addRunRegions(regions, runs[offset], runs[offset + 1], runs[offset + 2])
  }
  return [...regions].sort((a, b) => a - b)
}

export function regionsFromRunList(runs: readonly Run[]) {
  const regions = new Set<number>()
  for (const run of runs) regions.add((run.y >> 6) * 4 + (run.x0 >> 6))
  return [...regions].sort((a, b) => a - b)
}

export function regionsFromMask(mask: number) {
  return Array.from({ length: 16 }, (_, region) => region).filter((region) => (mask & (1 << region)) !== 0)
}

export function overlapSummary(yours: readonly number[], otherPaints: readonly number[][]) {
  const yoursSet = new Set(yours)
  const otherRegions = new Set(otherPaints.flat())
  const overlappingPaints = otherPaints.filter((regions) =>
    regions.some((region) => yoursSet.has(region)),
  ).length
  return {
    otherRegions: [...otherRegions].sort((a, b) => a - b),
    overlappingPaints,
    text:
      otherPaints.length === 0
        ? 'no other paints landed in this block.'
        : `${otherPaints.length} other paint${
            otherPaints.length === 1 ? '' : 's'
          } landed in this block, in regions ${[...otherRegions].join(', ')}.`,
  }
}
