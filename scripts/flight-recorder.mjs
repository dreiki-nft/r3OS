#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatFlightRecordText, makeFlightRecord } from './flight-recorder-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const valueOf = (name, fallback) => {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : fallback
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`r3OS mainnet flight recorder\n\nusage:\n  node scripts/flight-recorder.mjs --input <json> [--out-dir artifacts]\n\nThe input must be human-reviewed launch evidence. This tool never queries RPC, signs, or sends transactions.\nIt writes deterministic mainnet-launch.json, mainnet-launch.txt and mainnet-launch.sha256.`)
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
  const { record, json, hash } = makeFlightRecord(input)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, 'mainnet-launch.json'), json)
  writeFileSync(resolve(outDir, 'mainnet-launch.txt'), formatFlightRecordText(record, hash))
  writeFileSync(resolve(outDir, 'mainnet-launch.sha256'), `${hash}\n`)
  console.log(`R3OS_MAINNET_GENESIS ${hash}`)
} catch (error) {
  console.error(error?.message ?? error)
  process.exit(1)
}
