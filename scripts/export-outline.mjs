import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = path.join(root, 'contracts/src/R3tardsPaint.sol')
const outPath = path.join(root, 'src/lib/generated/outline.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const match = source.match(/bytes\s+private\s+constant\s+_OUTLINE_RUNS\s*=\s*hex"([0-9a-fA-F]+)";/)
if (!match) throw new Error('Could not find _OUTLINE_RUNS in R3tardsPaint.sol')

const hex = match[1].toLowerCase()
if (hex.length % 6 !== 0) throw new Error('_OUTLINE_RUNS must contain packed 3-byte runs')

const runs = []
for (let i = 0; i < hex.length; i += 6) {
  const y = Number.parseInt(hex.slice(i, i + 2), 16)
  const xStart = Number.parseInt(hex.slice(i + 2, i + 4), 16)
  const xEnd = Number.parseInt(hex.slice(i + 4, i + 6), 16)
  runs.push([y, xStart, xEnd])
}

const generated = `// GENERATED FILE. DO NOT EDIT.\n// Source: contracts/src/R3tardsPaint.sol::_OUTLINE_RUNS\n\nexport const OUTLINE_RUNS_HEX = '0x${hex}' as const\n\nexport const OUTLINE_RUNS: ReadonlyArray<readonly [number, number, number]> = ${JSON.stringify(runs)}\n`
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, generated)
console.log(`wrote ${path.relative(root, outPath)} (${runs.length} runs)`)
