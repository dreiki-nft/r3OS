import { applyDf1 } from './df1'

export interface Df1Source64Input {
  /** `frameData(tokenId)`: 256x256 4bpp background, BMP bottom-up. */
  frameData: Uint8Array
  /** `genesisFrameData(season)`: the season outline as 256x256 4bpp bottom-up, outline = 1, else 0. */
  outlineGenesis: Uint8Array
  palette: readonly number[]
  face: number
  background: number
}

/**
 * Build the same bytes as `genesisFrameData(season)` from packed outline runs (y, x0, x1).
 * Runs are OR-ed, exactly like the core's stored outline mask, so overlapping runs count once.
 * Use this only to preview an outline that is not onchain yet; otherwise read genesisFrameData.
 */
export function outlineGenesisFromRuns(runs: Uint8Array): Uint8Array {
  if (runs.length % 3 !== 0) throw new Error('runs must be packed 3-byte runs')
  const out = new Uint8Array(32_768)
  for (let o = 0; o < runs.length; o += 3) {
    const y = runs[o]
    const x0 = runs[o + 1]
    const x1 = runs[o + 2]
    if (x0 > x1) throw new Error(`invalid run ${o / 3}: x0 > x1`)
    const row = (255 - y) * 128
    for (let x = x0; x <= x1; x++) out[row + (x >> 1)] |= (x & 1) === 0 ? 0x10 : 0x01
  }
  return out
}

/** Count outline pixels per 4x4 block. Index = cellY * 64 + cellX, top-down. */
export function outlineCellCounts(outlineGenesis: Uint8Array): Uint8Array {
  if (outlineGenesis.length !== 32_768) throw new Error('outlineGenesis must be 32768 bytes')
  const counts = new Uint8Array(64 * 64)
  for (let y = 0; y < 256; y++) {
    const row = (255 - y) * 128
    const cellRow = (y >> 2) * 64
    for (let x = 0; x < 256; x++) {
      const byte = outlineGenesis[row + (x >> 1)]
      const nibble = (x & 1) === 0 ? byte >> 4 : byte & 0x0f
      if (nibble !== 0) counts[cellRow + (x >> 2)]++
    }
  }
  return counts
}

/**
 * Mirror of Source64.rows: 64x64 palette indices, top-down, one byte per cell (index 0 = background).
 * Each cell samples the top-left pixel of its 4x4 block; 6+ outline pixels in the block make it `face`.
 * DF1Renderer and R3OSForks both start from exactly this grid.
 */
export function source64Indices(frameData: Uint8Array, outlineGenesis: Uint8Array, face: number): Uint8Array {
  if (frameData.length !== 32_768) throw new Error('frameData must be 32768 bytes')
  const counts = outlineCellCounts(outlineGenesis)
  const out = new Uint8Array(64 * 64)
  for (let y = 0; y < 64; y++) {
    const srcRow = 255 - 4 * y
    for (let x = 0; x < 64; x++) {
      out[y * 64 + x] = counts[y * 64 + x] >= 6 ? face : frameData[srcRow * 128 + 2 * x] >> 4
    }
  }
  return out
}

/** Mirror the onchain DF1Renderer source builder exactly: 64x64, top-down, opaque RGB. */
export function buildDf1Source64({
  frameData,
  outlineGenesis,
  palette,
  face,
  background,
}: Df1Source64Input): Uint8ClampedArray {
  if (palette.length !== 16) throw new Error('palette must contain 16 colors')
  const indices = source64Indices(frameData, outlineGenesis, face)
  const colors = [...palette]
  colors[0] = palette[background]
  const rgb = new Uint8ClampedArray(64 * 64 * 3)
  for (let i = 0; i < indices.length; i++) {
    const color = colors[indices[i]]
    rgb[i * 3] = (color >> 16) & 0xff
    rgb[i * 3 + 1] = (color >> 8) & 0xff
    rgb[i * 3 + 2] = color & 0xff
  }
  return rgb
}

/** Apply exact DF1 v1 to the 64x64 RGB source and return RGB bytes, matching the onchain renderer. */
export function df1View64(sourceRgb: Uint8Array, seed: number, amount: number): Uint8ClampedArray {
  if (sourceRgb.length !== 64 * 64 * 3) throw new Error('sourceRgb must be 12288 bytes')
  const rgba = new Uint8ClampedArray(64 * 64 * 4)
  for (let i = 0, j = 0; i < sourceRgb.length; i += 3, j += 4) {
    rgba[j] = sourceRgb[i]
    rgba[j + 1] = sourceRgb[i + 1]
    rgba[j + 2] = sourceRgb[i + 2]
    rgba[j + 3] = 255
  }
  const filtered = applyDf1(rgba, seed, amount)
  const rgb = new Uint8ClampedArray(sourceRgb.length)
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    rgb[i] = filtered[j]
    rgb[i + 1] = filtered[j + 1]
    rgb[i + 2] = filtered[j + 2]
  }
  return rgb
}
