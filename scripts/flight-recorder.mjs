#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assembleFlightRecord, formatFlightRecordText, makeFlightRecord } from './flight-recorder-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const valueOf = (name, fallback) => {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : fallback
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`r3OS mainnet flight recorder\n\npreferred usage:\n  node scripts/flight-recorder.mjs \\
    --input <base-json> \\
    --doctor <finalized-launch-doctor.json> \\
    --manifest <mainnet-deployment-manifest.json> \\
    --acceptance <local-acceptance-gates.json> \\
    --canary <mainnet-canary.json> \\
    [--out-dir artifacts]\n\nThe tool assembles chain evidence from Launch Doctor and the Phase 9D canary rather than asking a human to retype addresses/hashes.\nIt never queries RPC, signs, or sends transactions.`)
  process.exit(0)
}

function readJson(path, label) {
  if (!path) throw new Error(`missing ${label}`)
  try {
    return JSON.parse(readFileSync(resolve(root, path), 'utf8'))
  } catch (error) {
    throw new Error(`unable to read ${label}: ${error?.message ?? error}`)
  }
}

const inputPath = valueOf('--input')
const doctorPath = valueOf('--doctor')
const manifestPath = valueOf('--manifest')
const acceptancePath = valueOf('--acceptance')
const canaryPath = valueOf('--canary')
const outDir = resolve(root, valueOf('--out-dir', 'artifacts'))

try {
  const baseInput = readJson(inputPath, '--input JSON')
  const doctor = readJson(doctorPath, '--doctor JSON')
  const manifest = readJson(manifestPath, '--manifest JSON')
  const acceptance = readJson(acceptancePath, '--acceptance JSON')
  const canary = readJson(canaryPath, '--canary JSON')
  const assembled = assembleFlightRecord({ baseInput, doctor, manifest, acceptance, canary })
  const { record, json, hash } = makeFlightRecord(assembled)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(resolve(outDir, 'mainnet-launch.json'), json)
  writeFileSync(resolve(outDir, 'mainnet-launch.txt'), formatFlightRecordText(record, hash))
  writeFileSync(resolve(outDir, 'mainnet-launch.sha256'), `${hash}\n`)
  console.log(`R3OS_MAINNET_GENESIS ${hash}`)
} catch (error) {
  console.error(error?.message ?? error)
  process.exit(1)
}
