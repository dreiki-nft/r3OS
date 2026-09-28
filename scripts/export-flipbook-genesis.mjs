import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outlinePath = path.join(root, 'src/lib/generated/outline.ts')
const outPath = path.join(root, 'contracts/script/flipbook-genesis.hex')
const source = fs.readFileSync(outlinePath, 'utf8')
const match = source.match(/OUTLINE_RUNS_HEX\s*=\s*'0x([0-9a-fA-F]+)'/)
if (!match) throw new Error('Could not find OUTLINE_RUNS_HEX in src/lib/generated/outline.ts')

const packed = match[1]
if (packed.length % 6 !== 0) throw new Error('outline runs must be packed 3-byte tuples')

const outline = Array.from({ length: 256 }, () => new Uint8Array(256))
for (let i = 0; i < packed.length; i += 6) {
  const y = Number.parseInt(packed.slice(i, i + 2), 16)
  const x0 = Number.parseInt(packed.slice(i + 2, i + 4), 16)
  const x1 = Number.parseInt(packed.slice(i + 4, i + 6), 16)
  for (let x = x0; x <= x1; x++) outline[y][x] = 1
}

const CROP_X = 54
const CROP_Y = 58
const SAMPLE = 5
const cells = new Uint8Array(32 * 32)
for (let y = 0; y < 32; y++) {
  for (let x = 0; x < 32; x++) {
    let hits = 0
    for (let sy = 0; sy < SAMPLE; sy++) {
      for (let sx = 0; sx < SAMPLE; sx++) {
        hits += outline[CROP_Y + y * SAMPLE + sy][CROP_X + x * SAMPLE + sx]
      }
    }
    cells[y * 32 + x] = hits >= 12 ? 1 : 0
  }
}

const bytes = new Uint8Array(512)
for (let i = 0; i < cells.length; i += 2) bytes[i >> 1] = (cells[i] << 4) | cells[i + 1]
const hex = `0x${Buffer.from(bytes).toString('hex')}`
fs.writeFileSync(outPath, hex)
console.log(`wrote ${path.relative(root, outPath)} (${bytes.length} bytes, ${cells.reduce((a, b) => a + b, 0)} black cells)`)
