import { encodeAbiParameters, keccak256 } from 'viem'

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
] as const

export const DISC = [4, 5, 6, 8, 9, 10, 11, 12, 13, 14] as const
export const DISC_MASK = DISC.reduce((mask, index) => mask | (1 << index), 0)

const R4 = 2798
const RIM4 = 2591
const HOLE4 = 41
const HOLERING4 = 67
const HUB4 = 231
const HUBRING4 = 282
const CLEAR4 = 339
const SPAN4 = R4 - CLEAR4

const C_HOLERING = [90, 90, 96]
const C_HUB = [246, 246, 248]
const C_HUBRING = [150, 152, 158]
const C_CLEAR = [208, 216, 222]
const C_RIM = [76, 76, 82]
const SILVER = [
  [126, 126, 132],
  [172, 174, 180],
  [216, 218, 224],
  [240, 241, 244],
]
const GLARE = [242, 243, 246]
const WHITE = [255, 255, 255]

type Rgb = readonly [number, number, number] | readonly number[]

export const lerp1 = (a: number, b: number, t: number) => Math.floor((a * (4096 - t) + b * t + 2048) / 4096)

function lerp(a: Rgb, b: Rgb, t: number): [number, number, number] {
  return [lerp1(a[0], b[0], t), lerp1(a[1], b[1], t), lerp1(a[2], b[2], t)]
}

export const smooth = (t: number) => Math.floor((t * t * (12288 - 2 * t)) / 16777216)

function oct(t: number) {
  return Math.floor(t / 4) + Math.floor((356 * t * (4096 - t)) / 16777216)
}

export function angle(px: number, py: number) {
  const ax = Math.abs(px)
  const ay = Math.abs(py)
  let a = ax >= ay ? oct(Math.floor((ay * 4096) / ax)) : 2048 - oct(Math.floor((ax * 4096) / ay))
  if (px < 0) a = 4096 - a
  if (py < 0) a = 8192 - a
  return a
}

export function toHsv([r, g, b]: Rgb): [number, number, number] {
  const mx = Math.max(r, g, b)
  const mn = Math.min(r, g, b)
  const d = mx - mn
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
export const HUE_ORDER = [...DISC].sort((a, b) => HSV[a][0] - HSV[b][0] || a - b)

export function fromHsv(h: number, s: number, v: number): [number, number, number] {
  const sector = Math.floor(h / 256)
  const f = h % 256
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
  ][sector] as [number, number, number]
}

export function hsvLerp(ia: number, ib: number, t: number) {
  const [ha, sa, va] = HSV[ia]
  const [hb, sb, vb] = HSV[ib]
  let h: number
  if (hb >= ha) {
    const d = hb - ha
    h = d <= 768 ? ha + Math.floor((d * t) / 4096) : ha + 1536 - Math.floor(((1536 - d) * t) / 4096)
  } else {
    const d = ha - hb
    h = d <= 768 ? ha + 1536 - Math.floor((d * t) / 4096) : ha + Math.floor(((1536 - d) * t) / 4096)
  }
  return fromHsv(h % 1536, lerp1(sa, sb, t), lerp1(va, vb, t))
}

export function trackColours(counts: readonly number[]) {
  const out: number[] = []
  for (let k = 0; k < 2; k++) {
    let best = -1
    for (const index of DISC) {
      if (counts[index] > 0 && !out.includes(index) && (best < 0 || counts[index] > counts[best]))
        best = index
    }
    if (best >= 0) out.push(best)
  }
  return out
}

export function background(tracks: number): [number, number, number] {
  return tracks <= 4 ? [242, 239, 233] : tracks <= 8 ? [192, 192, 192] : [0, 128, 128]
}

export function raster(seed: bigint, tracks: number, mask: number) {
  const stops = HUE_ORDER.filter((index) => (mask >> index) & 1)
  const n = stops.length
  const twistRaw = Number((seed & 0xffffn) % 2869n)
  const phase = Number((seed >> 16n) & 4095n)
  const sphase = Number((seed >> 28n) & 4095n)
  const glints: number[] = []
  for (let j = 0; j < 1 + Math.floor(tracks / 6); j++)
    glints.push(Number((seed >> BigInt(40 + 12 * j)) & 4095n))
  const fanW = 1638 + 49 * tracks
  const bg = background(tracks)
  const rgb = new Uint8Array(64 * 64 * 3)

  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const px = 2 * x + 1 - 64
      const py = 2 * y - 58
      const d4 = px * px + py * py
      let c: Rgb
      if (d4 > R4 || d4 < HOLE4) c = bg
      else if (d4 < HOLERING4) c = C_HOLERING
      else if (d4 < HUB4) c = C_HUB
      else if (d4 < HUBRING4) c = C_HUBRING
      else if (d4 < CLEAR4) c = C_CLEAR
      else if (d4 >= RIM4) c = C_RIM
      else {
        const u0 = angle(px, py) % 4096
        const dd = Math.min(d4 - CLEAR4, SPAN4)
        const u =
          twistRaw >= 1434
            ? (u0 + Math.floor(((twistRaw - 1434) * dd) / SPAN4) + phase) % 4096
            : (u0 + 4096 - Math.floor(((1434 - twistRaw) * dd) / SPAN4) + phase) % 4096
        const w = (2 * u + sphase) % 4096
        const s12 = smooth(2 * Math.abs(w - 2048))
        const k = s12 * 3
        const i = Math.min(Math.floor(k / 4096), 2)
        c = lerp(SILVER[i], SILVER[i + 1], k - i * 4096)
        if (n > 0) {
          const f = (u + 4096 - 737) % 4096
          if (f < fanW) {
            let col: Rgb
            if (n === 1) col = PAL[stops[0]]
            else {
              const kk = f * (n - 1)
              const si = Math.floor(kk / fanW)
              col = hsvLerp(stops[si], stops[si + 1], smooth(Math.floor(((kk - si * fanW) * 4096) / fanW)))
            }
            const e = Math.min(f, fanW - f)
            const te = Math.min(4096, Math.floor((e * 4096 * 25) / (fanW * 3)))
            c = lerp(lerp(c, GLARE, 2867), col, smooth(te))
          }
        }
        for (const g of glints) {
          const a = u >= g ? u - g : g - u
          const dist = Math.min(a, 4096 - a)
          if (dist < 123) c = lerp(c, WHITE, smooth(Math.floor(((123 - dist) * 4096) / 123)))
        }
      }
      const offset = (y * 64 + x) * 3
      rgb[offset] = c[0]
      rgb[offset + 1] = c[1]
      rgb[offset + 2] = c[2]
    }
  }
  return rgb
}

function write16(data: Uint8Array, offset: number, value: number) {
  data[offset] = value & 0xff
  data[offset + 1] = (value >>> 8) & 0xff
}

function write32(data: Uint8Array, offset: number, value: number) {
  data[offset] = value & 0xff
  data[offset + 1] = (value >>> 8) & 0xff
  data[offset + 2] = (value >>> 16) & 0xff
  data[offset + 3] = (value >>> 24) & 0xff
}

export function bmp64(rgb: Uint8Array) {
  const out = new Uint8Array(54 + rgb.length)
  out[0] = 0x42
  out[1] = 0x4d
  write32(out, 2, out.length)
  write32(out, 10, 54)
  write32(out, 14, 40)
  write32(out, 18, 64)
  write32(out, 22, 64)
  write16(out, 26, 1)
  write16(out, 28, 24)
  write32(out, 34, rgb.length)
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const source = (y * 64 + x) * 3
      const target = 54 + (63 - y) * 192 + x * 3
      out[target] = rgb[source + 2]
      out[target + 1] = rgb[source + 1]
      out[target + 2] = rgb[source]
    }
  }
  return out
}

function base64(bytes: Uint8Array) {
  let binary = ''
  const chunk = 0x8000
  for (let start = 0; start < bytes.length; start += chunk) {
    binary += String.fromCharCode(...bytes.subarray(start, Math.min(bytes.length, start + chunk)))
  }
  return btoa(binary)
}

export function seedOf(tokenId: number | bigint, frameIds: readonly (number | bigint)[]) {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'uint256[]' }],
        [BigInt(tokenId), frameIds.map(BigInt)],
      ),
    ),
  )
}

export const formatName = (count: number) =>
  count === 1 ? 'single' : count <= 4 ? 'ep' : count <= 8 ? 'album' : 'full length'

export function svg({
  tokenId,
  frameIds,
  label,
  mask,
}: {
  tokenId: number | bigint
  frameIds: readonly (number | bigint)[]
  label: string
  mask: number
}) {
  const n = frameIds.length
  const seed = seedOf(tokenId, frameIds)
  const image = base64(bmp64(raster(seed, n, mask & DISC_MASK)))
  const [ink, dim] =
    n <= 4 ? ['#111111', '#8a877f'] : n <= 8 ? ['#111111', '#5b5b5b'] : ['#f2efe9', '#bfe3e3']
  let out =
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" shape-rendering="crispEdges">'
  out += `<image width="512" height="512" style="image-rendering:pixelated" href="data:image/bmp;base64,${image}"/>`
  out += `<rect x="12.5" y="12.5" width="487" height="487" fill="none" stroke="${dim}"/>`
  out += `<text x="24" y="470" font-family="monospace" font-size="14" fill="${ink}">${label.replaceAll('&', '&amp;')}</text>`
  out += `<text x="24" y="492" font-family="monospace" font-size="12" fill="${dim}">cd-r · ${n} track${n === 1 ? '' : 's'} · ${formatName(n)}</text>`
  out += `<text x="488" y="492" font-family="monospace" font-size="12" fill="${dim}" text-anchor="end">#${String(tokenId).padStart(4, '0')}</text>`
  return { svg: `${out}</svg>`, seed }
}

export function sampleTrackCounts(packed: Uint8Array, backgroundColour: number) {
  if (packed.length !== 32_768) throw new Error(`expected 32768 packed bytes, got ${packed.length}`)
  const counts = Array<number>(16).fill(0)
  for (let y = 0; y < 32; y++) {
    const sourceRow = 255 - y * 8
    for (let x = 0; x < 32; x++) {
      const byte = packed[sourceRow * 128 + x * 4]
      const nibble = byte >> 4
      counts[nibble === 0 ? backgroundColour : nibble]++
    }
  }
  return counts
}

export function discMaskFromCounts(countSets: readonly (readonly number[])[]) {
  let mask = 0
  for (const counts of countSets) {
    for (const colour of trackColours(counts)) mask |= 1 << colour
  }
  return mask & DISC_MASK
}

const LABEL_RE = /^[a-z0-9 !?.,'&#-]+$/

export function normalizeCdLabel(value: string) {
  const normalized = value.toLowerCase()
  if (normalized.length < 1 || normalized.length > 24) return { valid: false, value: normalized }
  return { valid: LABEL_RE.test(normalized), value: normalized }
}
