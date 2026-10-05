#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { makeManifest } from './mainnet-manifest-lib.mjs'
import {
  MAINNET_REHEARSAL_SCHEMA,
  assertDryRunArgsSafe,
  assertRehearsalDisarmed,
  coreDryRunArgs,
  formatFoundryEnv,
  foundryEnvFromManifest,
  hasStaleBuildArtifactsWarning,
  parseFoundryDryRunSummary,
  redactSecrets,
} from './mainnet-rehearse-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contractsRoot = resolve(root, 'contracts')
const argv = process.argv.slice(2)
const valueOf = (name, fallback) => {
  const direct = argv.find((arg) => arg.startsWith(`${name}=`))
  if (direct) return direct.slice(name.length + 1)
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : fallback
}

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`r3OS guarded mainnet rehearsal\n\nusage:\n  RPC_URL=<mainnet-rpc> npm run mainnet:rehearse -- --input docs/MAINNET_DEPLOYMENT_INPUT.local.json\n\nRuns only:\n  1. PLAN_ONLY manifest generation\n  2. read-only Finalized mainnet preflight\n  3. local deploy-profile forge clean\n  4. core Foundry simulation WITHOUT --broadcast/--resume\n\nIt refuses to run while any mainnet approval flag is armed and never stores the RPC URL.`)
  process.exit(0)
}

const inputPath = valueOf('--input')
const outDir = resolve(root, valueOf('--out-dir', 'artifacts'))
const rpcUrl = process.env.RPC_URL
if (!inputPath) {
  console.error('missing --input (use --help)')
  process.exit(2)
}
if (!rpcUrl) {
  console.error('RPC_URL is required in the local environment')
  process.exit(2)
}

try {
  assertRehearsalDisarmed(process.env)
} catch (error) {
  console.error(error?.message ?? error)
  process.exit(1)
}

let input
try {
  input = JSON.parse(readFileSync(resolve(root, inputPath), 'utf8'))
} catch (error) {
  console.error(`unable to read input JSON: ${error?.message ?? error}`)
  process.exit(2)
}

let built
try {
  built = makeManifest(input)
} catch (error) {
  console.error(error?.message ?? error)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'mainnet-deployment-manifest.json'), built.json)
writeFileSync(resolve(outDir, 'mainnet-deployment-manifest.sha256'), `${built.hash}\n`)
writeFileSync(resolve(outDir, 'MAINNET_DEPLOYMENT_PLAN.md'), built.markdown)

const foundryEnv = foundryEnvFromManifest(built.manifest)
writeFileSync(resolve(outDir, 'mainnet-foundry-plan.env'), formatFoundryEnv(foundryEnv))

const childEnv = {
  ...process.env,
  ...foundryEnv,
  CONFIRM_MAINNET: 'false',
  CONFIRM_ACCEPT_OWNERSHIP: 'false',
  CONFIRM_FREEZE_RENDERERS: 'false',
  FOUNDRY_PROFILE: 'deploy',
}

console.log(`manifest: ${built.hash}`)
console.log('rehearsal state: DISARMED')
console.log('step 1/3: read-only Finalized preflight')
const preflight = spawnSync(
  process.execPath,
  ['scripts/mainnet-preflight.mjs', '--input', inputPath, '--out-dir', valueOf('--out-dir', 'artifacts')],
  { cwd: root, env: childEnv, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
)
const preflightText = redactSecrets(`${preflight.stdout ?? ''}${preflight.stderr ?? ''}`, [rpcUrl])
process.stdout.write(preflightText)
if (preflight.error || preflight.status !== 0) {
  const summary = {
    schema: MAINNET_REHEARSAL_SCHEMA,
    generatedAt: new Date().toISOString(),
    manifestHash: built.hash,
    rpcUrlStored: false,
    approvalFlagsArmed: false,
    preflight: 'FAIL',
    foundryClean: 'NOT_RUN',
    coreDryRun: 'NOT_RUN',
    readyForDeploymentReview: false,
  }
  writeFileSync(resolve(outDir, 'mainnet-rehearsal.json'), `${JSON.stringify(summary, null, 2)}\n`)
  console.error('rehearsal stopped: preflight is not green')
  process.exit(1)
}

console.log('step 2/3: clean deploy-profile Foundry artifacts (LOCAL ONLY)')
const clean = spawnSync('forge', ['clean'], {
  cwd: contractsRoot,
  env: childEnv,
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
})
const cleanText = redactSecrets(`${clean.stdout ?? ''}${clean.stderr ?? ''}`, [rpcUrl])
process.stdout.write(cleanText)
if (clean.error || clean.status !== 0) {
  const summary = {
    schema: MAINNET_REHEARSAL_SCHEMA,
    generatedAt: new Date().toISOString(),
    manifestHash: built.hash,
    rpcUrlStored: false,
    approvalFlagsArmed: false,
    preflight: 'PASS',
    foundryClean: 'FAIL',
    coreDryRun: 'NOT_RUN',
    readyForDeploymentReview: false,
  }
  writeFileSync(resolve(outDir, 'mainnet-rehearsal.json'), `${JSON.stringify(summary, null, 2)}\n`)
  if (clean.error) console.error(`forge clean failed to start: ${clean.error.message}`)
  console.error('rehearsal stopped: deploy-profile Foundry clean failed')
  process.exit(1)
}

console.log('step 3/3: core Foundry dry-run (NO BROADCAST)')
const args = coreDryRunArgs().map((value) => (value === '__RPC_URL__' ? rpcUrl : value))
assertDryRunArgsSafe(args)
const dryRun = spawnSync('forge', args, {
  cwd: contractsRoot,
  env: childEnv,
  encoding: 'utf8',
  maxBuffer: 50 * 1024 * 1024,
})
const dryRunText = redactSecrets(`${dryRun.stdout ?? ''}${dryRun.stderr ?? ''}`, [rpcUrl])
writeFileSync(resolve(outDir, 'MAINNET_CORE_DRY_RUN.txt'), dryRunText)
process.stdout.write(dryRunText)

const staleBuildArtifactsDetected = hasStaleBuildArtifactsWarning(dryRunText)
const foundry = parseFoundryDryRunSummary(dryRunText)
const transactionGasLimitOk = foundry.maxTransactionGasLimit == null || foundry.maxTransactionGasLimit <= 30_000_000
const dryRunOk = !dryRun.error && dryRun.status === 0 && !staleBuildArtifactsDetected && transactionGasLimitOk
const summary = {
  schema: MAINNET_REHEARSAL_SCHEMA,
  generatedAt: new Date().toISOString(),
  manifestHash: built.hash,
  rpcUrlStored: false,
  approvalFlagsArmed: false,
  broadcastArgsPresent: false,
  preflight: 'PASS',
  foundryClean: 'PASS',
  staleBuildArtifactsDetected,
  transactionGasLimitOk,
  foundry,
  coreDryRun: dryRunOk ? 'PASS' : 'FAIL',
  readyForDeploymentReview: dryRunOk,
}
writeFileSync(resolve(outDir, 'mainnet-rehearsal.json'), `${JSON.stringify(summary, null, 2)}\n`)

if (!dryRunOk) {
  if (dryRun.error) console.error(`forge dry-run failed to start: ${dryRun.error.message}`)
  if (staleBuildArtifactsDetected) console.error('rehearsal blocked: stale Foundry artifacts were detected after a clean build')
  if (!transactionGasLimitOk) console.error(`rehearsal blocked: transaction gas limit exceeds Monad 30M cap (${foundry.maxTransactionGasLimit})`)
  console.error('rehearsal result: BLOCKED')
  process.exit(1)
}

console.log('rehearsal result: READY FOR HUMAN DEPLOYMENT REVIEW')
console.log('NO TRANSACTIONS WERE BROADCAST')
