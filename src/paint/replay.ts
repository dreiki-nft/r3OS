export interface PaintedLogLike {
  blockNumber: bigint
  logIndex: number
  runs: Uint8Array
  corruptions: Uint8Array
}
export function expandOutlineRuns(runs: Uint8Array) {
  const mask = new Uint8Array(256 * 256)
  for (let o = 0; o + 2 < runs.length; o += 3) {
    const y = runs[o],
      x0 = runs[o + 1],
      x1 = runs[o + 2]
    for (let x = x0; x <= x1; x++) mask[y * 256 + x] = 1
  }
  return mask
}
export function applyPainted(
  background: Uint8Array,
  outlineMask: Uint8Array,
  runs: Uint8Array,
  corruptions: Uint8Array,
) {
  const out = background.slice()
  for (let o = 0; o + 3 < runs.length; o += 4) {
    const y = runs[o],
      x0 = runs[o + 1],
      x1 = runs[o + 2],
      c = runs[o + 3]
    for (let x = x0; x <= x1; x++) {
      const i = y * 256 + x
      if (outlineMask[i]) continue
      if (out[i] !== c) out[i] = c
    }
  }
  for (let o = 0; o + 2 < corruptions.length; o += 3) {
    const x = corruptions[o],
      y = corruptions[o + 1],
      c = corruptions[o + 2]
    out[y * 256 + x] = c
  }
  return out
}
export function replayLogs(
  background: Uint8Array,
  outlineMask: Uint8Array,
  logs: PaintedLogLike[],
  snapshotBlock: bigint,
) {
  let out = background.slice()
  for (const l of [...logs].sort((a, b) =>
    a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
  )) {
    if (l.blockNumber <= snapshotBlock) continue
    out = applyPainted(out, outlineMask, l.runs, l.corruptions)
  }
  return out
}
