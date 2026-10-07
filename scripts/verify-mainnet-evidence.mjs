#!/usr/bin/env node
// Verify the published Phase 9D evidence offline. No RPC, wallet, writes or dependencies.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'docs', 'submission', 'mainnet-evidence')
const expected = {
  source: '42a17e62140d474d59922bb922599defac39d856',
  genesis: '6b07e83382d4f06d03620084b2b13205768f8b081e88c27661fee8c2d3a2a137',
  manifest: '307580c4fc98f28cee605a5a5bd348f08a9f1eba71788bd26eaced86e0cf67f1',
  canary: '0x71821fedd32fbacd582d76fbb4a1ddd767e3590f6d779ea6131ad0f96221eb8c',
  finalizedBlock: '111045783',
  finalizedHash: '0x1a333ec173b4f667ec9d36269b458501b70b446c68744ca31e2998352dada3bd',
  owner: '0x40ea55e0b8f02f8ebc9d91e082e202ed988647fa',
  paint: '0x5102de3817ae16b3afaeb9d180130669a70787b3',
}
let passed = 0
const errors = []
const verify = (condition, message) => {
  if (condition) passed++
  else errors.push(message)
}
const bytes = (name) => readFileSync(join(dir, name))
const json = (name) => JSON.parse(bytes(name).toString('utf8'))
const sha = (data) => createHash('sha256').update(data).digest('hex')
const lower = (value) => typeof value === 'string' ? value.toLowerCase() : ''
const eqAddr = (a, b) => lower(a) === lower(b) && lower(a).startsWith('0x')
const digestText = (name) => bytes(name).toString('utf8').trim().replace(/^0x/, '').toLowerCase()

try {
  // The Flight Recorder marker hashes canonical raw JSON bytes, not prettified JSON.
  const launch = json('mainnet-launch.json')
  const manifest = json('mainnet-deployment-manifest.json')
  const doctor = json('doctor-finalized.json')
  const canary = json('mainnet-canary.json')
  const addresses = json('mainnet-deployment-addresses.json')
  const local = json('local-acceptance-gates.json')
  verify(sha(bytes('mainnet-launch.json')) === expected.genesis, 'raw genesis JSON SHA-256')
  verify(digestText('mainnet-launch.sha256') === expected.genesis, 'published genesis SHA-256')
  verify(sha(bytes('mainnet-deployment-manifest.json')) === expected.manifest, 'raw deployment manifest SHA-256')
  verify(digestText('mainnet-deployment-manifest.sha256') === expected.manifest, 'published manifest SHA-256')
  verify(lower(launch.deploymentManifest?.sha256) === `0x${expected.manifest}`, 'embedded manifest SHA-256')
  verify(launch.genesisLabel === 'R3OS_MAINNET_GENESIS', 'genesis evidence label')
  verify(launch.build?.gitIdentifier === expected.source, 'accepted source commit')
  verify(launch.chainId === 143 && manifest.chainId === 143 && doctor.chain?.id === 143 && canary.chainId === 143 && addresses.chainId === 143, 'mainnet chain 143 across evidence')
  verify(launch.finalizedReference?.blockNumber === expected.finalizedBlock && lower(launch.finalizedReference?.blockHash) === expected.finalizedHash, 'launch finalized anchor')
  verify(doctor.block === expected.finalizedBlock && lower(doctor.blockHash) === expected.finalizedHash && doctor.commitment === 'finalized' && doctor.readOnly === true, 'doctor finalized/read-only anchor')
  verify(doctor.summary?.OK === 106 && doctor.summary?.WARN === 0 && doctor.summary?.FAIL === 0 && doctor.summary?.UNKNOWN === 1 && doctor.exitCode === 0, 'doctor acceptance summary')
  verify(launch.freezeStates?.renderersFrozen === true && launch.freezeStates?.experimentsFrozen === false && doctor.evidence?.freezeStates?.renderersFrozen === true && doctor.evidence?.freezeStates?.experimentsFrozen === false, 'intentional freeze state')
  verify(manifest.freezeIntentions?.experiments === 'keep-open' && manifest.freezeIntentions?.renderers === 'freeze-after-acceptance', 'manifest freeze intentions')
  verify(eqAddr(manifest.finalOwner, expected.owner) && eqAddr(launch.deploymentManifest?.finalOwner, expected.owner), 'accepted owner')
  verify(eqAddr(launch.contracts?.R3OSPaint?.address, expected.paint), 'Paint contract address')
  verify(addresses.complete === true && addresses.missing?.length === 0 && addresses.schema === 'r3os-mainnet-deployment-addresses/v2', 'complete finalized address list')
  const names = Object.keys(addresses.contracts ?? {})
  verify(names.length === 16 && Object.keys(launch.contracts ?? {}).length === 16 && Object.keys(doctor.evidence?.contracts ?? {}).length === 16, '16 contract entries in all evidence sources')
  for (const name of names) {
    const fromAddresses = addresses.contracts[name]
    const fromLaunch = launch.contracts?.[name]
    const fromDoctor = doctor.evidence?.contracts?.[name]
    verify(Boolean(fromAddresses && fromLaunch && fromDoctor) && eqAddr(fromAddresses.address, fromLaunch.address) && eqAddr(fromLaunch.address, fromDoctor.address), `contract address ${name}`)
    verify(Boolean(fromLaunch?.codeHash && fromDoctor?.codeHash) && lower(fromLaunch.codeHash) === lower(fromDoctor.codeHash), `contract code hash ${name}`)
  }
  verify(Object.values(addresses.deploymentStages ?? {}).length === 5 && Object.values(addresses.deploymentStages ?? {}).every((s) => s.ok === true), 'all deployment stages marked complete')
  verify(launch.renderers?.length === 4 && launch.renderers?.map((r) => r.id).join(',') === '0,1,2,3', 'frozen four-renderer registry')
  const eventState = doctor.sections?.find((s) => s.name === 'SYSTEM EVENT')?.checks?.find((c) => c.label === 'State')
  verify(eventState?.status === 'OK' && eventState?.value === 'ARMED', 'System Event is armed (not activated) at acceptance')
  const tx = canary.transaction
  verify(canary.mode === 'transaction' && canary.readOnly === false && tx?.executed === true && lower(tx.hash) === expected.canary && tx.blockNumber === '111045205', 'canary transaction/height')
  verify(tx?.receiptStatus === 'success' && tx.paintEventObserved === true && tx.visualStateRestored === true && tx.canary?.finalVisibleColor === 0, 'canary receipt/log and canvas restored')
  verify(tx?.commitStates?.join(',') === 'Proposed,Voted,Finalized,Verified' && tx.proposedObserved === true && tx.votedObserved === true && tx.finalizedObserved === true, 'real canary commitment observations')
  verify(tx?.primaryFinalized === true && tx.secondaryFinalized === true && tx.secondProviderReceipt === true && tx.secondProviderCanonicalBlock === true && canary.splitBrain?.status === 'OK', 'multi-provider canary consistency')
  verify(canary.summary?.OK === 21 && canary.summary?.WARN === 0 && canary.summary?.FAIL === 0 && canary.exitCode === 0, 'canary summary')
  verify(launch.gates?.mainnetCanary?.transaction?.hash === tx.hash && launch.gates?.mainnetCanary?.transaction?.blockHash === tx.blockHash, 'canary matches canonical Flight Recorder')
  verify(launch.gates?.launchDoctor?.summary?.OK === 106 && launch.gates?.launchDoctor?.blockNumber === doctor.block, 'Flight Recorder launch doctor matches')
  verify(local.allGreen === true && Object.keys(local.gates ?? {}).length === 9 && Object.values(local.gates ?? {}).every((g) => g.exitCode === 0), 'local acceptance recorded all green')
  verify(launch.gates?.localAcceptance?.allGreen === true && launch.gates?.localAcceptance?.completedAt === local.completedAt, 'local acceptance matches Flight Recorder')
  // Per-file custody hashes: separate from the two canonical Flight Recorder digests.
  const sums = bytes('SHA256SUMS').toString('utf8').trim().split('\n')
  verify(sums.length === 9, 'custody hash inventory (nine source files)')
  for (const line of sums) {
    const match = line.match(/^([0-9a-f]{64})  ([a-z0-9.-]+)$/)
    verify(Boolean(match) && sha(bytes(match[2])) === match[1], `custody SHA-256 for ${match?.[2] ?? line}`)
  }
} catch (error) {
  errors.push(`Failed to read/parse evidence: ${error.message}`)
}

if (errors.length) {
  for (const err of errors) process.stderr.write(`FAIL: ${err}\n`)
  process.stderr.write(`MAINNET EVIDENCE VERIFICATION FAILED (${passed} checks passed, ${errors.length} failed)\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`MAINNET EVIDENCE VERIFIED: ${passed} offline checks passed\n`)
  process.stdout.write(`R3OS_MAINNET_GENESIS: 0x${expected.genesis}\n`)
  process.stdout.write('Scope: attached acceptance snapshots and hashes; no live RPC or explorer verification.\n')
}
