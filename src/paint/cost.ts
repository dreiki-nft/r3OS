export interface TilePreviewState {
  heat: number
  wetBitmap: bigint
}
export function decayTileHeat(
  state: TilePreviewState,
  cachedBlock: bigint,
  headBlock: bigint,
  cooldownPerBlock: bigint,
): TilePreviewState {
  if (headBlock <= cachedBlock || state.heat <= 0 || cooldownPerBlock <= 0n) return state
  const decay = (headBlock - cachedBlock) * cooldownPerBlock
  const heat = BigInt(state.heat)
  return { ...state, heat: decay >= heat ? 0 : Number(heat - decay) }
}

export interface PaintCost {
  pixels: number
  units: number
  blank: number
  wet: number
  dry: number
  overheatTiles: number[]
  /** Same tiles as overheatTiles, with current heat and the heat this stroke would add. */
  overheat: { tile: number; heat: number; add: number }[]
}
export function previewPaintCost(
  baseline: Uint8Array,
  working: Uint8Array,
  outline: Uint8Array,
  tiles: Map<number, TilePreviewState>,
  maxHeat: number,
): PaintCost {
  let pixels = 0,
    units = 0,
    blank = 0,
    wet = 0,
    dry = 0
  const heatAdd = new Map<number, number>()
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++) {
      const i = y * 256 + x
      if (outline[i] || baseline[i] === working[i]) continue
      pixels++
      const tile = (y >> 4) * 16 + (x >> 4)
      const state = tiles.get(tile) ?? { heat: 0, wetBitmap: 0n }
      if (baseline[i] === 0) {
        blank++
        units++
        heatAdd.set(tile, (heatAdd.get(tile) ?? 0) + 1)
      } else {
        const bit = BigInt((y & 15) * 16 + (x & 15))
        if (((state.wetBitmap >> bit) & 1n) !== 0n) {
          wet++
          units++
        } else {
          dry++
          units += 2
          heatAdd.set(tile, (heatAdd.get(tile) ?? 0) + 2)
        }
      }
    }
  const overheat = [...heatAdd]
    .map(([tile, add]) => ({ tile, heat: tiles.get(tile)?.heat ?? 0, add }))
    .filter((entry) => entry.heat + entry.add > maxHeat)
  const overheatTiles = overheat.map((entry) => entry.tile)
  return { pixels, units, blank, wet, dry, overheatTiles, overheat }
}
