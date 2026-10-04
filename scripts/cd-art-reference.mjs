// r3OS labs CD-R art v2: reference implementation.
// The Solidity port (contracts/src/lib/CDArt.sol) must produce byte-identical SVG for the same inputs.
// Non-negative integer maths only (every division is floor division of non-negative numbers) + keccak256.
// Run: node scripts/cd-art-reference.mjs   (prints the HSV table, hue order and golden hashes)
import { keccak256, encodeAbiParameters, toHex } from 'viem'
import { pathToFileURL } from 'node:url'

// Palette (src/lib/palette.ts). Index 0 is "background" and never reaches the disc.
export const PAL = [
  [255, 255, 255],
  [0, 0, 0],
  [150, 94, 75],
  [135, 117, 73],
  [197, 32, 32],
  [254, 195, 67],
  [238, 147, 227],
  [255, 255, 255],
  [7, 153, 47],
  [160, 5, 93],
  [105, 75, 135],
  [95, 237, 223],
  [247, 147, 26],
  [200, 100, 170],
  [159, 112, 218],
  [212, 120, 39],
]
// Colours allowed on the disc: no background/black/white, no trippie brown (2), old man olive (3) or emoji orange (15).
export const DISC = [4, 5, 6, 8, 9, 10, 11, 12, 13, 14]
export const DISC_MASK = DISC.reduce((m, i) => m | (1 << i), 0) // 0x7f70

// ---------- geometry (raster 64 x 64, shown at 8x). Distances in "d4" units: (2 * radius_in_px)^2 ----------
// pixel centre relative to disc centre (32.0, 29.5), doubled: px = 2x + 1 - 64 (odd), py = 2y - 58 (even)
const R4 = 2798 // outer edge, r = 26.45
const RIM4 = 2591 // d4 >= RIM4 -> rim colour (r > 25.45)
const HOLE4 = 41 // d4 < HOLE4 -> hole (background shows through)
const HOLERING4 = 67
const HUB4 = 231
const HUBRING4 = 282
const CLEAR4 = 339 // surface starts here
const SPAN4 = R4 - CLEAR4 // 2459

const C_HOLERING = [90, 90, 96],
  C_HUB = [246, 246, 248],
  C_HUBRING = [150, 152, 158],
  C_CLEAR = [208, 216, 222],
  C_RIM = [76, 76, 82]
const SILVER = [
  [126, 126, 132],
  [172, 174, 180],
  [216, 218, 224],
  [240, 241, 244],
]
const GLARE = [242, 243, 246],
  WHITE = [255, 255, 255]

// Q12 helpers: fractions are 0..4096
export const lerp1 = (a, b, t) => Math.floor((a * (4096 - t) + b * t + 2048) / 4096)
const lerp = (a, b, t) => [lerp1(a[0], b[0], t), lerp1(a[1], b[1], t), lerp1(a[2], b[2], t)]
export const smooth = (t) => Math.floor((t * t * (12288 - 2 * t)) / 16777216) // smoothstep, t in 0..4096

// ---------- angle: half-turn = 4096 units ----------
// oct(t): atan(t / 4096) in units where 1/8 turn = 1024, for t in 0..4096
const oct = (t) => Math.floor(t / 4) + Math.floor((356 * t * (4096 - t)) / 16777216)
// returns the angle of (px, py) in 0..8191 (full turn = 8192), then the caller takes it mod 4096
export function angle(px, py) {
  const ax = Math.abs(px),
    ay = Math.abs(py)
  let a = ax >= ay ? oct(Math.floor((ay * 4096) / ax)) : 2048 - oct(Math.floor((ax * 4096) / ay))
  if (px < 0) a = 4096 - a
  if (py < 0) a = 8192 - a
  return a
}

// ---------- colour: integer HSV, hue 0..1535 (6 x 256), s and v 0..255 ----------
export function toHsv([r, g, b]) {
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b),
    d = mx - mn
  const s = mx === 0 ? 0 : Math.floor((255 * d) / mx)
  let h = 0
  if (d > 0) {
    if (mx === r) h = g >= b ? Math.floor((256 * (g - b)) / d) : 1536 - Math.floor((256 * (b - g)) / d)
    else if (mx === g)
      h = b >= r ? 512 + Math.floor((256 * (b - r)) / d) : 512 - Math.floor((256 * (r - b)) / d)
    else h = r >= g ? 1024 + Math.floor((256 * (r - g)) / d) : 1024 - Math.floor((256 * (g - r)) / d)
  }
  return [h % 1536, s, mx]
}
export const HSV = PAL.map(toHsv)
// disc colours in rainbow order: by hue, ties by palette index
export const HUE_ORDER = [...DISC].sort((a, b) => HSV[a][0] - HSV[b][0] || a - b)

export function fromHsv(h, s, v) {
  const sector = Math.floor(h / 256),
    f = h % 256
  const p = Math.floor((v * (255 - s)) / 255)
  const q = Math.floor((v * (65280 - s * f)) / 65280)
  const t = Math.floor((v * (65280 - s * (256 - f))) / 65280)
  return [
    [v, t, p],
    [q, v, p],
    [p, v, t],
    [p, q, v],
    [t, p, v],
    [v, p, q],
  ][sector]
}
// gradient between two palette colours, going the short way round the colour wheel
export function hsvLerp(ia, ib, t) {
  const [ha, sa, va] = HSV[ia],
    [hb, sb, vb] = HSV[ib]
  let h
  if (hb >= ha) {
    const d = hb - ha
    h = d <= 768 ? ha + Math.floor((d * t) / 4096) : ha + 1536 - Math.floor(((1536 - d) * t) / 4096)
  } else {
    const d = ha - hb
    h = d <= 768 ? ha + 1536 - Math.floor((d * t) / 4096) : ha + Math.floor(((1536 - d) * t) / 4096)
  }
  return fromHsv(h % 1536, lerp1(sa, sb, t), lerp1(va, vb, t))
}

// ---------- mint-time: a track's two main disc colours ----------
// counts[16]: samples per palette index (index 0 already mapped to the frame's background colour).
// Picks up to two DISC colours with the highest count (count > 0), ties to the lower index.
export function trackColours(counts) {
  const out = []
  for (let k = 0; k < 2; k++) {
    let best = -1
    for (const i of DISC)
      if (counts[i] > 0 && !out.includes(i) && (best < 0 || counts[i] > counts[best])) best = i
    if (best >= 0) out.push(best)
  }
  return out
}

// ---------- the raster ----------
export function background(tracks) {
  return tracks <= 4 ? [242, 239, 233] : tracks <= 8 ? [192, 192, 192] : [0, 128, 128]
}

// seed: uint256 (BigInt). tracks: 1..12. mask: uint16 of palette indices on the disc (only DISC bits count).
export function raster(seed, tracks, mask) {
  const stops = HUE_ORDER.filter((i) => (mask >> i) & 1)
  const n = stops.length
  const twistRaw = Number((seed & 0xffffn) % 2869n)
  const phase = Number((seed >> 16n) & 4095n)
  const sphase = Number((seed >> 28n) & 4095n)
  const glints = []
  for (let j = 0; j < 1 + Math.floor(tracks / 6); j++)
    glints.push(Number((seed >> BigInt(40 + 12 * j)) & 4095n))
  const fanW = 1638 + 49 * tracks
  const bg = background(tracks)
  const rgb = new Uint8Array(64 * 64 * 3)

  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const px = 2 * x + 1 - 64,
        py = 2 * y - 58,
        d4 = px * px + py * py
      let c
      if (d4 > R4 || d4 < HOLE4) c = bg
      else if (d4 < HOLERING4) c = C_HOLERING
      else if (d4 < HUB4) c = C_HUB
      else if (d4 < HUBRING4) c = C_HUBRING
      else if (d4 < CLEAR4) c = C_CLEAR
      else if (d4 >= RIM4) c = C_RIM
      else {
        // u: position around the half-turn (the disc is point-symmetric), with a seed swirl that grows toward the rim
        const u0 = angle(px, py) % 4096
        const dd = Math.min(d4 - CLEAR4, SPAN4)
        const u =
          twistRaw >= 1434
            ? (u0 + Math.floor(((twistRaw - 1434) * dd) / SPAN4) + phase) % 4096
            : (u0 + 4096 - Math.floor(((1434 - twistRaw) * dd) / SPAN4) + phase) % 4096
        // brushed silver: triangle wave (2 per half-turn), smoothed, across 4 greys
        const w = (2 * u + sphase) % 4096
        const s12 = smooth(2 * Math.abs(w - 2048))
        const k = s12 * 3,
          i = Math.min(Math.floor(k / 4096), 2)
        c = lerp(SILVER[i], SILVER[i + 1], k - i * 4096)
        // rainbow fan
        if (n > 0) {
          const f = (u + 4096 - 737) % 4096
          if (f < fanW) {
            let col
            if (n === 1) col = PAL[stops[0]]
            else {
              const kk = f * (n - 1),
                si = Math.floor(kk / fanW)
              col = hsvLerp(stops[si], stops[si + 1], smooth(Math.floor(((kk - si * fanW) * 4096) / fanW)))
            }
            const e = Math.min(f, fanW - f)
            const te = Math.min(4096, Math.floor((e * 4096 * 25) / (fanW * 3))) // edge fade over 12% of the fan
            c = lerp(lerp(c, GLARE, 2867), col, smooth(te))
          }
        }
        // glints
        for (const g of glints) {
          const a = u >= g ? u - g : g - u,
            dist = Math.min(a, 4096 - a)
          if (dist < 123) c = lerp(c, WHITE, smooth(Math.floor(((123 - dist) * 4096) / 123)))
        }
      }
      const o = (y * 64 + x) * 3
      rgb[o] = c[0]
      rgb[o + 1] = c[1]
      rgb[o + 2] = c[2]
    }
  return rgb
}

// 24-bit BMP, bottom-up rows, BGR, 54-byte header: identical to BmpN.encode(rgb, 64).
export function bmp64(rgb) {
  const b = Buffer.alloc(54 + rgb.length)
  b.write('BM', 0, 'latin1')
  b.writeUInt32LE(b.length, 2)
  b.writeUInt32LE(54, 10)
  b.writeUInt32LE(40, 14)
  b.writeUInt32LE(64, 18)
  b.writeUInt32LE(64, 22)
  b.writeUInt16LE(1, 26)
  b.writeUInt16LE(24, 28)
  b.writeUInt32LE(rgb.length, 34)
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const s = (y * 64 + x) * 3,
        d = 54 + (63 - y) * 192 + x * 3
      b[d] = rgb[s + 2]
      b[d + 1] = rgb[s + 1]
      b[d + 2] = rgb[s]
    }
  return b
}

// seed = uint256(keccak256(abi.encode(uint256 tokenId, uint256[] frameIds)))
export const seedOf = (tokenId, frameIds) =>
  BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'uint256[]' }],
        [BigInt(tokenId), frameIds.map(BigInt)],
      ),
    ),
  )

export const formatName = (n) => (n === 1 ? 'single' : n <= 4 ? 'ep' : n <= 8 ? 'album' : 'full length')

// label: already validated + lowercased at mint (a-z 0-9 space ! ? . , ' & - #). Only & needs escaping.
export function svg({ tokenId, frameIds, label, mask }) {
  const n = frameIds.length
  const seed = seedOf(tokenId, frameIds)
  const img = bmp64(raster(seed, n, mask & DISC_MASK)).toString('base64')
  const [ink, dim] =
    n <= 4 ? ['#111111', '#8a877f'] : n <= 8 ? ['#111111', '#5b5b5b'] : ['#f2efe9', '#bfe3e3']
  let out =
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" shape-rendering="crispEdges">'
  out += `<image width="512" height="512" style="image-rendering:pixelated" href="data:image/bmp;base64,${img}"/>`
  out += `<rect x="12.5" y="12.5" width="487" height="487" fill="none" stroke="${dim}"/>`
  out += `<text x="24" y="470" font-family="monospace" font-size="14" fill="${ink}">${label.replaceAll('&', '&amp;')}</text>`
  out += `<text x="24" y="492" font-family="monospace" font-size="12" fill="${dim}">cd-r · ${n} track${n === 1 ? '' : 's'} · ${formatName(n)}</text>`
  out += `<text x="488" y="492" font-family="monospace" font-size="12" fill="${dim}" text-anchor="end">#${String(tokenId).padStart(4, '0')}</text>`
  return { svg: out + '</svg>', seed }
}

// Golden vectors for the Foundry test (CDArt.t.sol).
export const GOLDEN = [
  { name: 'single', tokenId: 42, frameIds: [1204], label: 'first paint', mask: (1 << 5) | (1 << 6) },
  {
    name: 'ep',
    tokenId: 7,
    frameIds: [88, 1204, 5, 77],
    label: 'gm tracks',
    mask: (1 << 4) | (1 << 5) | (1 << 8) | (1 << 10) | (1 << 13) | (1 << 6),
  },
  {
    name: 'album',
    tokenId: 213,
    frameIds: [3, 9, 27, 81, 243, 729, 2187],
    label: 'summer mix & more',
    mask: (1 << 12) | (1 << 8) | (1 << 14) | (1 << 13) | (1 << 5) | (1 << 11),
  },
  {
    name: 'full length',
    tokenId: 1205,
    frameIds: [11, 22, 33, 44, 55, 66, 77, 88, 99, 110, 121, 132],
    label: 'storm chasers',
    mask: DISC_MASK,
  },
  { name: 'plain silver', tokenId: 12345, frameIds: [500, 501], label: 'b&w only', mask: 0 },
  { name: 'one colour', tokenId: 3, frameIds: [9], label: 'all green', mask: 1 << 8 },
]

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('HSV (h 0..1535, s, v) for DISC colours:')
  for (const i of DISC) console.log(`  ${i}: ${HSV[i].join(', ')}`)
  console.log('HUE_ORDER:', HUE_ORDER.join(', '))
  for (const g of GOLDEN) {
    const { svg: s, seed } = svg(g)
    const r = raster(seed, g.frameIds.length, g.mask & DISC_MASK)
    console.log(
      g.name.padEnd(13),
      'svg',
      keccak256(new TextEncoder().encode(s)),
      s.length,
      'raster',
      keccak256(toHex(r)),
    )
  }
}
