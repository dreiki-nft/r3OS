// r3 pass art v2 (black & white + DF1): reference implementation.
// The Solidity port (contracts/src/lib/PassArt.sol) must produce byte-identical SVG for the same Params.
// Integer maths + keccak256 only. DF1 is the exact onchain DF1 v1 (contracts/src/lib/DF1.sol, tables read from it).
import { keccak256, encodePacked, encodeAbiParameters } from 'viem'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const df1Sol = fs.readFileSync(path.join(here, '../contracts/src/lib/DF1.sol'), 'utf8')
const TH = Buffer.from(df1Sol.match(/THRESHOLDS = hex"([0-9a-f]+)"/)[1], 'hex')
const RA = Buffer.from(df1Sol.match(/RADII = hex"([0-9a-f]+)"/)[1], 'hex')

const GREYS = [224, 192, 160, 128] // accent tones; 2 picked per pass. The main tone is always 255.
const MAX_PINS = 16
const W = 64                  // raster is 64 x 64, shown at 8x (512 x 512)
const N = 16, H = 8, CELL = 3 // 16 x 16 creature, 8 generated columns mirrored, 3 raster px per cell
const X0 = 8, Y0 = 5          // creature top-left in raster px (box = 48 x 48)
const BOX = N * CELL

// h(seed, tag, i) = uint256(keccak256(abi.encodePacked(uint256 seed, string tag, uint256 i)))
const h = (seed, tag, i) => BigInt(keccak256(encodePacked(['uint256', 'string', 'uint256'], [seed, tag, BigInt(i)])))
const log2 = (x) => { let n = 0; while (x > 1n) { x >>= 1n; n++ } return n } // floor(log2(x)), x >= 1

// Exact DF1 v1 as in contracts/src/lib/DF1.sol (mulberry32, per-pixel RGB, amount 0..200).
export function df1(rgb, seed, amount) {
  if (amount > 200) amount = 200
  const T = TH.readUInt32BE(amount * 4), R = RA[amount], span = 2 * R + 1
  let state = seed >>> 0 || 1
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), state | 1) >>> 0
    t = (t ^ ((t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0)) >>> 0
    return (t ^ (t >>> 14)) >>> 0
  }
  const out = new Uint8Array(rgb.length)
  for (let o = 0; o < rgb.length; o += 3) {
    const u = next(), r = [next(), next(), next()]
    for (let c = 0; c < 3; c++) {
      if (u < T) out[o + c] = r[c] >>> 24
      else {
        let v = rgb[o + c] + Math.floor((r[c] * span) / 4294967296)
        if (v < R) v = R
        if (v > 255 + R) v = 255 + R
        out[o + c] = v - R
      }
    }
  }
  return out
}

// 24-bit BMP, bottom-up rows, BGR, 54-byte header: identical to DF1Renderer._buildBMP.
function bmp64(rgb) {
  const b = Buffer.alloc(54 + rgb.length)
  b.write('BM', 0, 'latin1'); b.writeUInt32LE(b.length, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14)
  b.writeUInt32LE(64, 18); b.writeUInt32LE(64, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28); b.writeUInt32LE(rgb.length, 34)
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const s = (y * 64 + x) * 3, d = 54 + (63 - y) * 192 + x * 3
    b[d] = rgb[s + 2]; b[d + 1] = rgb[s + 1]; b[d + 2] = rgb[s]
  }
  return b
}

/**
 * @param p {{ owner: string, tokenId: number, pixels: number, frames: number, days: number, stormPaints: number,
 *             firstPaintBlock: number, holder: boolean, pinCount: number, pinMask: number }}
 * pinCount = 6 + stamp sources, capped at 16. pinMask bit i = pin i earned.
 */
export function passArt(p) {
  // seed = uint256(keccak256(abi.encode(owner, tokenId)))
  const seed = BigInt(keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [p.owner.toLowerCase(), BigInt(p.tokenId)])))

  // tones: [255, a, b]. k = 0..1: j = h(seed,"cw",k) % pool.length; take pool[j]; remove it (shift left).
  const pool = [...GREYS], tone = [255]
  for (let k = 0; k < 2; k++) { const j = Number(h(seed, 'cw', k) % BigInt(pool.length)); tone.push(pool.splice(j, 1)[0]) }
  const TONE_OF = [0, 0, 1, 2] // cell tone = tone[TONE_OF[(v >> 8) % 4]]: half white, a quarter each accent

  // creature: density % = min(60, 14 + 3 * floor(log2(pixels + 1))). 0 = empty.
  const density = Math.min(60, 14 + 3 * log2(BigInt(p.pixels) + 1n))
  const grid = []
  for (let y = 0; y < N; y++) {
    grid.push([])
    for (let x = 0; x < H; x++) {
      const v = h(seed, 'c', y * H + x)
      grid[y].push(Number(v % 100n) < density ? tone[TONE_OF[Number((v >> 8n) % 4n)]] : 0)
    }
  }

  // storm rows: count = min(4, floor(log2(storm + 1)) + (storm > 0 ? 1 : 0)). row = h(seed,"g",k) % 16,
  // shift = 2 + h(seed,"gs",k) % 4 raster px. A later k on the same row overwrites the shift.
  const shiftOf = new Array(N).fill(0)
  const gRows = Math.min(4, log2(BigInt(p.stormPaints) + 1n) + (p.stormPaints > 0 ? 1 : 0))
  for (let k = 0; k < gRows; k++) shiftOf[Number(h(seed, 'g', k) % 16n)] = 2 + Number(h(seed, 'gs', k) % 4n)

  // raster (one grey byte per px, top-down)
  const g = new Uint8Array(W * W)
  for (let y = 0; y < N; y++) {
    const shift = shiftOf[y]
    for (let py = Y0 + y * CELL; py < Y0 + y * CELL + CELL; py++) {
      if (shift) for (let x = 0; x < W; x++) g[py * W + x] = 56 // storm band across the full width
      for (let bx = 0; bx < BOX; bx++) {
        const x = Math.floor(bx / CELL), c = x < H ? grid[y][x] : grid[y][N - 1 - x]
        if (c) g[py * W + X0 + ((bx + shift) % BOX)] = c
      }
    }
  }
  // frames: k = 0..min(8, frames)-1: i = h(seed,"s",k) % 128, y = i / 8, x = i % 8. Skip if that cell is on.
  // Otherwise the centre px of cell (x, y) and of cell (15 - x, y) becomes 255 (unshifted).
  for (let k = 0; k < Math.min(8, p.frames); k++) {
    const i = Number(h(seed, 's', k) % 128n), y = Math.floor(i / H), x = i % H
    if (grid[y][x]) continue
    for (const xx of [x, N - 1 - x]) g[(Y0 + y * CELL + 1) * W + X0 + xx * CELL + 1] = 255
  }

  // holders get the negative: every raster px v becomes 255 - v.
  const rgb = new Uint8Array(W * W * 3)
  for (let i = 0; i < W * W; i++) { const v = p.holder ? 255 - g[i] : g[i]; rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = v }

  // DF1: seed = uint32(firstPaintBlock), amount = min(200, 20 + 15 * floor(log2(storm + 1))).
  const df1Seed = p.firstPaintBlock % 2 ** 32
  const df1Amount = Math.min(200, 20 + 15 * log2(BigInt(p.stormPaints) + 1n))
  const img = bmp64(df1(rgb, df1Seed, df1Amount)).toString('base64')

  // vector overlay colours
  const ink = p.holder ? '#0b0b0c' : '#f2efe9', dim = p.holder ? '#a3a09a' : '#3d3d44'
  let out = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" shape-rendering="crispEdges">'
  out += `<image width="512" height="512" style="image-rendering:pixelated" href="data:image/bmp;base64,${img}"/>`
  out += `<rect x="12.5" y="12.5" width="487" height="487" fill="none" stroke="${p.holder ? '#0b0b0c' : '#3d3d44'}"/>`

  // days: 30 ticks. x = 64 + floor(d * 64 / 5), y = 436, 8 x 4. ink if d < min(30, days) else dim.
  for (let d = 0; d < 30; d++) out += `<rect x="${64 + Math.floor((d * 64) / 5)}" y="436" width="8" height="4" fill="${d < Math.min(30, p.days) ? ink : dim}"/>`
  // pins: 14 x 14 at x = 64 + i * 22, y = 450. Earned: filled ink. Not earned: dim outline at +.5.
  for (let i = 0; i < Math.min(MAX_PINS, p.pinCount); i++) {
    const x = 64 + i * 22
    out += (p.pinMask >> i) & 1
      ? `<rect x="${x}" y="450" width="14" height="14" fill="${ink}"/>`
      : `<rect x="${x}.5" y="450.5" width="13" height="13" fill="none" stroke="${dim}"/>`
  }
  out += `<text x="24" y="490" font-family="monospace" font-size="14" fill="${ink}">r3 pass</text>`
  out += `<text x="488" y="490" font-family="monospace" font-size="12" fill="#6b6b73" text-anchor="end">#${String(p.tokenId).padStart(4, '0')}</text>`
  return { svg: out + '</svg>', df1Seed, df1Amount }
}

// Golden vectors for the Foundry test. Run: node scripts/pass-art-reference.mjs
export const GOLDEN = [
  { name: 'first paint', owner: '0x1111111111111111111111111111111111111111', tokenId: 912, pixels: 40, frames: 0, days: 1, stormPaints: 0, firstPaintBlock: 48213377, holder: false, pinCount: 11, pinMask: 0b1 },
  { name: 'regular holder', owner: '0x7fa9385be102ac3eac297483dd6233d62b3e1496', tokenId: 42, pixels: 12480, frames: 10, days: 23, stormPaints: 0, firstPaintBlock: 48200004, holder: true, pinCount: 11, pinMask: 0b10010110111 },
  { name: 'storm chaser', owner: '0x9b3f00000000000000000000000000000000e3a1', tokenId: 7, pixels: 4200, frames: 3, days: 9, stormPaints: 55, firstPaintBlock: 48199311, holder: false, pinCount: 11, pinMask: 0b10000011011 },
  { name: 'whale', owner: '0xd07a00000000000000000000000000000005c19f', tokenId: 12345, pixels: 180000, frames: 40, days: 34, stormPaints: 300, firstPaintBlock: 48190001, holder: true, pinCount: 11, pinMask: 0b11111111111 },
]

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const g of GOLDEN) {
    const { svg, df1Seed, df1Amount } = passArt(g)
    console.log(g.name.padEnd(16), keccak256(new TextEncoder().encode(svg)), svg.length, `df1 ${df1Seed}/${df1Amount}`)
  }
}
