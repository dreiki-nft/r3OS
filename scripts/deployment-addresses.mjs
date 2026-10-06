#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MAINNET_BROADCAST_FILES,
  MAINNET_JOURNAL_FILES,
  extractCreatedContracts,
  extractJournalContracts,
  mergeContractEvidence,
  assessDeploymentStages,
  verifyFoundryCreatesAgainstJournals,
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
  console.log('r3OS deployment address collector\n\nusage:\n  npm run mainnet:collect-addresses -- [--broadcast-root contracts/broadcast] [--journal-root artifacts] [--out-dir artifacts]\n\nReconciles local Foundry chain-143 artifacts with guarded broadcaster journals. Never queries RPC and never signs or broadcasts.')
  process.exit(0)
}

const broadcastRoot = resolve(root, valueOf('--broadcast-root', 'contracts/broadcast'))
const journalRoot = resolve(root, valueOf('--journal-root', 'artifacts'))
const outDir = resolve(root, valueOf('--out-dir', 'artifacts'))

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`unable to read ${label}: ${error?.message ?? error}`)
  }
}

const runs = []
for (const relative of MAINNET_BROADCAST_FILES) {
  const path = resolve(broadcastRoot, relative)
  if (!existsSync(path)) continue
  runs.push({ run: readJson(path, relative), source: relative })
}

const journals = []
for (const relative of MAINNET_JOURNAL_FILES) {
  const path = resolve(journalRoot, relative)
  if (!existsSync(path)) continue
  journals.push({ journal: readJson(path, relative), source: relative })
}

if (runs.length === 0 && journals.length === 0) {
  console.error(`no mainnet deployment evidence found under ${broadcastRoot} or ${journalRoot}`)
  process.exit(1)
}

try {
  const evidenceItems = [
    ...runs.flatMap(({ run, source }) => extractCreatedContracts(run, source)),
    ...journals.flatMap(({ journal, source }) => extractJournalContracts(journal, source)),
  ]
  const result = mergeContractEvidence(evidenceItems)
  const stageEvidence = assessDeploymentStages(journals)

  const coreRun = runs.find((item) => item.source === 'Deploy.s.sol/143/run-latest.json')
  if (!coreRun) throw new Error('missing reviewed CORE Foundry artifact Deploy.s.sol/143/run-latest.json')
  const coreCreatesVerified = verifyFoundryCreatesAgainstJournals(coreRun.run, journals, coreRun.source)

  const complete = result.complete && stageEvidence.complete
  mkdirSync(outDir, { recursive: true })
  const artifact = {
    schema: 'r3os-mainnet-deployment-addresses/v2',
    chainId: 143,
    generatedAt: new Date().toISOString(),
    evidenceModel: 'foundry-artifacts+guarded-broadcaster-journals',
    broadcastFilesRead: runs.map((item) => item.source),
    journalFilesRead: journals.map((item) => item.source),
    coreCreatesVerifiedAgainstFinalizedReceipts: coreCreatesVerified,
    complete,
    missing: result.missing,
    deploymentStages: stageEvidence.stages,
    contracts: Object.fromEntries(Object.entries(result.contracts).map(([name, address]) => [name, {
      address,
      source: CONTRACT_SOURCES[name],
      evidence: result.evidence[name]?.source,
      evidenceKind: result.evidence[name]?.evidenceKind,
    }])),
  }

  writeFileSync(resolve(outDir, 'mainnet-deployment-addresses.json'), `${JSON.stringify(artifact, null, 2)}\n`)
  writeFileSync(resolve(outDir, 'mainnet-addresses.env'), formatAddressEnv(result))

  const total = Object.keys(result.contracts).length + result.missing.length
  console.log(`mainnet deployment addresses: ${Object.keys(result.contracts).length}/${total}`)
  console.log(`deployment stage evidence: ${stageEvidence.complete ? '5/5 PASS' : 'INCOMPLETE'}`)
  console.log(`CORE CREATE receipts reconciled: ${coreCreatesVerified}`)
  if (result.missing.length) console.log(`still missing addresses: ${result.missing.join(', ')}`)
  for (const [name, stage] of Object.entries(stageEvidence.stages)) {
    console.log(`  ${name}: ${stage.ok ? `PASS (${stage.mode})` : `FAIL (${stage.reason})`}`)
  }
  console.log(`overall evidence status: ${complete ? 'COMPLETE' : 'INCOMPLETE'}`)
  console.log('wrote artifacts/mainnet-deployment-addresses.json and artifacts/mainnet-addresses.env')
  if (!complete) process.exitCode = 2
} catch (error) {
  console.error(error?.message ?? error)
  process.exit(1)
}
