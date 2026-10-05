#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeManifest } from './mainnet-manifest-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const valueOf = (name, fallback) => {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : fallback
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`r3OS mainnet deployment manifest\n\nusage:\n  node scripts/mainnet-manifest.mjs --input <json> [--out-dir artifacts]\n\nValidates reviewed chain-143 launch inputs and writes MAINNET_DEPLOYMENT_PLAN.md plus a canonical JSON/hash.\nIt never queries RPC, signs, or broadcasts transactions.`)
  process.exit(0)
}

const inputPath = valueOf('--input')
const outDir = resolve(root, valueOf('--out-dir', 'artifacts'))
if (!inputPath) {
  console.error('missing --input (use --help)')
  process.exit(2)
}

let input
try {
  input = JSON.parse(readFileSync(resolve(root, inputPath), 'utf8'))
} catch (error) {
  console.error(`unable to read input JSON: ${error?.message ?? error}`)
  process.exit(2)
}

try {
  const { json, hash, markdown } = makeManifest(input)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, 'mainnet-deployment-manifest.json'), json)
  writeFileSync(resolve(outDir, 'mainnet-deployment-manifest.sha256'), `${hash}\n`)
  writeFileSync(resolve(outDir, 'MAINNET_DEPLOYMENT_PLAN.md'), markdown)
  console.log(`mainnet deployment manifest ${hash}`)
} catch (error) {
  console.error(error?.message ?? error)
  process.exit(1)
}
