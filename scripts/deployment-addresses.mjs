#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAINNET_BROADCAST_FILES,
  mergeDeploymentRuns,
  formatAddressEnv,
  CONTRACT_SOURCES,
} from './deployment-addresses-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const valueOf = (name, fallback) => {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : fallback
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('r3OS deployment address collector\n\nusage:\n  npm run mainnet:collect-addresses -- [--broadcast-root contracts/broadcast] [--out-dir artifacts]\n\nReads local Foundry chain-143 broadcast artifacts only. Never queries RPC and never signs or broadcasts.')
  process.exit(0)
}

const broadcastRoot = resolve(root, valueOf('--broadcast-root', 'contracts/broadcast'))
const outDir = resolve(root, valueOf('--out-dir', 'artifacts'))
const runs = []
for (const relative of MAINNET_BROADCAST_FILES) {
  const path = resolve(broadcastRoot, relative)
  if (!existsSync(path)) continue
  let run
  try {
    run = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    console.error(`unable to read ${relative}: ${error?.message ?? error}`)
    process.exit(1)
  }
  runs.push({ run, source: relative })
}

if (runs.length === 0) {
  console.error(`no chain-143 Foundry broadcast artifacts found under ${broadcastRoot}`)
  process.exit(1)
}

try {
  const result = mergeDeploymentRuns(runs)
  mkdirSync(outDir, { recursive: true })
  const artifact = {
    schema: 'r3os-mainnet-deployment-addresses/v1',
    chainId: 143,
    generatedAt: new Date().toISOString(),
    broadcastFilesRead: runs.map((item) => item.source),
    complete: result.complete,
    missing: result.missing,
    contracts: Object.fromEntries(Object.entries(result.contracts).map(([name, address]) => [name, { address, source: CONTRACT_SOURCES[name] }])),
  }
  writeFileSync(resolve(outDir, 'mainnet-deployment-addresses.json'), `${JSON.stringify(artifact, null, 2)}\n`)
  writeFileSync(resolve(outDir, 'mainnet-addresses.env'), formatAddressEnv(result))
  console.log(`mainnet deployment addresses: ${Object.keys(result.contracts).length}/${Object.keys(result.contracts).length + result.missing.length}`)
  if (result.missing.length) console.log(`still missing: ${result.missing.join(', ')}`)
  console.log('wrote artifacts/mainnet-deployment-addresses.json and artifacts/mainnet-addresses.env')
} catch (error) {
  console.error(error?.message ?? error)
  process.exit(1)
}
