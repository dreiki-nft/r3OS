import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'contracts', 'out')
const limit = 131_072
const sourceDir = path.join(root, 'contracts', 'src')
const sourceBasenames = new Set()
const collectSources = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collectSources(full)
    else if (entry.name.endsWith('.sol')) sourceBasenames.add(entry.name)
  }
}
collectSources(sourceDir)

if (!fs.existsSync(outDir)) {
  throw new Error('contracts/out is missing. Run forge build first.')
}

const artifacts = []
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'build-info') walk(full)
      continue
    }
    if (!entry.name.endsWith('.json')) continue
    if (!sourceBasenames.has(path.basename(path.dirname(full)))) continue
    const data = JSON.parse(fs.readFileSync(full, 'utf8'))
    const object = data?.deployedBytecode?.object
    if (typeof object !== 'string' || object.length === 0) continue
    const hex = object.startsWith('0x') ? object.slice(2) : object
    if (!/^[0-9a-fA-F]*$/.test(hex)) continue
    artifacts.push({
      name: data.contractName ?? path.basename(entry.name, '.json'),
      file: path.relative(root, full),
      bytes: hex.length / 2,
    })
  }
}
walk(outDir)

if (artifacts.length === 0) throw new Error('No deployed contract bytecode found in contracts/out.')

artifacts.sort((a, b) => b.bytes - a.bytes)
let failed = false
for (const a of artifacts) {
  const status = a.bytes > limit ? 'FAIL' : 'ok'
  console.log(`${status.padEnd(4)} ${String(a.bytes).padStart(7)} B  ${a.name}  (${a.file})`)
  if (a.bytes > limit) failed = true
}
if (failed) {
  console.error(`Contract runtime exceeds Monad's 131,072-byte limit.`)
  process.exit(1)
}

