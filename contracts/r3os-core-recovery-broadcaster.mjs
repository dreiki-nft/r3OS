#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  serializeTransaction,
} from 'viem'

const EXPECTED_DEPLOYER = '0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA'
const PAINT = '0x5102DE3817aE16b3afaEb9D180130669A70787b3'
const LABS = '0xe6b3b17e3B1827FE02183F496e84331EBE74751C'
const DIFF = '0x5D2Dcd25D5E847770F6e8a7BFBDF1Df4F6E454F7'
const TIMELAPSE = '0x8C91D7A829569Ebf1DFC671F6cf328911813b78d'
const DF1 = '0x6eC2027e5B2493f2ECc5882BecE14B31197C3ce0'
const PASS = '0xb2D2D7681F451D9C69eD5eF2A0ed0B6b6494F103'
const AUCTION = '0x3D3154dB1B32724a82Ac9eC3f1811808558b9EF8'
const QUESTS = '0x4398f022d7700cf5541Ac59D2Ff83f1A8a30a6f1'
const RECYCLE = '0x02234e30daC8Bed319F30FB1Ec123da8bf71A2eb'
const CDBURNER = '0x5556B0ef2ffA3a970C852362EE69313C08f5B1cd'
const DELEGATOR = '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b'
const EXPECTED_MANIFEST = '0x307580c4fc98f28cee605a5a5bd348f08a9f1eba71788bd26eaced86e0cf67f1'
const EXPECTED_FAILED_TX = '0xea2e8f05ba2f00337975f8f40952cbed1d0c5673422443936c012bc225ada7b9'
const EXPECTED_BATCH_DATA_HASH = '0xa54ac2989083cbe13d4f6d3e9360832c960840ebdc938530436d0cad26738e06'
const EXPECTED_FIRST_RECOVERY_NONCE = 182n
const EXPECTED_FINAL_NONCE = 204n
const EXPECTED_ARTIFACT_TX_COUNT = 29
const EXPECTED_ARTIFACT_TOTAL_GAS = 54_467_082n
const EXPECTED_ARTIFACT_MAX_GAS = 23_661_866n
const MODE_BATCH = `0x01${'00'.repeat(31)}`

const INCIDENT_HASHES = [
  '0x412a9ef55f63ba24dd7f4ce235ef25f98c4abeb379a1c660db00318230e343eb',
  '0x42ebdae3f8e0a8d6bfda0ad8e24dac07e5c13747b6159887cafc926359b894f0',
  '0xbdf1b1dcdd6d868de515a08612f760965bf234c4920b72403561b8c4cbd0daf6',
  '0xb1b1b29705c2e9248968de35aa425843fb42fac1c8245d0539ca6a2f196af3a3',
  '0x3302ada571436de5af6af620be742a40a398e0357ca31a7d47b72bbf6e7dd709',
  '0xfe2c5f387c29b738b05bedb594d42653894bd2f04103eff4b24563ea1cf28397',
  EXPECTED_FAILED_TX,
]

const CREATE_EXPECTED_BY_NONCE = new Map([
  [185n, AUCTION],
  [187n, QUESTS],
  [190n, RECYCLE],
  [194n, CDBURNER],
])

// Same fee policy already approved for Phase 9C CORE.
const MAX_FEE_PER_GAS = 205_000_000_000n // 205 gwei
const PRIORITY_FEE_PER_GAS = 2_000_000_000n // 2 gwei
const MON = 10n ** 18n
const MIN_BALANCE = 20n * MON
const GAS_MARGIN_NUM = 130n
const GAS_MARGIN_DEN = 100n
const MAX_MONAD_GAS = 30_000_000n

const mode = process.argv.includes('--broadcast')
  ? 'broadcast'
  : process.argv.includes('--sign-check')
    ? 'sign-check'
    : 'check'

const cwd = process.cwd()
const artifactPath = path.resolve(cwd, 'broadcast/Deploy.s.sol/143/run-latest.json')
const originalJournalPath = path.resolve(cwd, '../artifacts/mainnet-core-broadcast-journal.json')
const recoveryJournalPath = path.resolve(cwd, '../artifacts/mainnet-core-recovery-journal.json')
const rpcUrl = process.env.RPC_URL || 'https://rpc.monad.xyz'
const verifyRpcUrl = process.env.VERIFY_RPC_URL || 'https://rpc.monad.xyz'
const account = process.env.R3OS_KEYSTORE_ACCOUNT || 'r3os-deployer'
const passwordFile = process.env.R3OS_KEYSTORE_PASSWORD_FILE || ''

const paintAbi = parseAbi([
  'function owner() view returns (address)',
  'function painterPass() view returns (address)',
  'function rendererCount() view returns (uint256)',
  'function experimentCount() view returns (uint256)',
  'function setPainterPass(address pass)',
  'function addRenderer(address renderer,string name) returns (uint256)',
])
const passAbi = parseAbi([
  'function owner() view returns (address)',
  'function PAINT() view returns (address)',
  'function stampSourceCount() view returns (uint256)',
  'function stampSource(uint256 sourceId) view returns (address)',
])
const ownableAbi = parseAbi(['function owner() view returns (address)'])
const questsAbi = parseAbi([
  'function owner() view returns (address)',
  'function questCount() view returns (uint256)',
])
const experimentIdAbi = parseAbi(['function experimentId() view returns (uint256)'])
const delegatorAbi = parseAbi([
  'function supportsExecutionMode(bytes32 mode) view returns (bool)',
  'function execute(bytes32 mode,bytes executionCalldata) payable',
])

function die(message) {
  console.error(`\nABORT: ${message}`)
  process.exit(1)
}

function asBigInt(value, label) {
  if (value == null) die(`${label} is missing`)
  try {
    return BigInt(value)
  } catch {
    die(`${label} is not an integer: ${value}`)
  }
}

function lower(value) {
  return String(value ?? '').toLowerCase()
}

function hex(value) {
  return `0x${BigInt(value).toString(16)}`
}

function atomicWrite(file, value) {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function runCast(args) {
  const castEnv = { ...process.env }
  delete castEnv.ETH_PASSWORD
  const result = spawnSync('cast', args, {
    env: castEnv,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) die(`failed to start cast: ${result.error.message}`)
  if (result.status !== 0) {
    const out = `${result.stdout || ''}${result.stderr || ''}`.trim()
    die(`cast ${args[0]} failed${out ? `:\n${out}` : ''}`)
  }
  return (result.stdout || '').trim()
}

let rpcId = 0
async function rpcAt(url, method, params = []) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  })
  const body = await res.json()
  if (body.error) {
    const error = new Error(`${method}: ${body.error.code} ${body.error.message}`)
    error.rpcError = body.error
    throw error
  }
  return body.result
}

function rpc(method, params = []) {
  return rpcAt(rpcUrl, method, params)
}

function verifyRpc(method, params = []) {
  return rpcAt(verifyRpcUrl, method, params)
}

async function waitForReceipt(hash, timeoutMs = 120_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const receipt = await rpc('eth_getTransactionReceipt', [hash])
    if (receipt) return receipt
    await sleep(400)
  }
  die(`timed out waiting for receipt ${hash}`)
}

async function waitUntilFinalAndClear(blockNumber, timeoutMs = 120_000) {
  const target = blockNumber + 4n
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const [latestRaw, finalized, verifyFinalized] = await Promise.all([
      rpc('eth_blockNumber'),
      rpc('eth_getBlockByNumber', ['finalized', false]),
      verifyRpc('eth_getBlockByNumber', ['finalized', false]),
    ])
    const latest = asBigInt(latestRaw, 'latest block')
    const finalizedNumber = finalized ? asBigInt(finalized.number, 'finalized block') : 0n
    const verifyFinalizedNumber = verifyFinalized
      ? asBigInt(verifyFinalized.number, 'verification finalized block')
      : 0n
    if (latest >= target && finalizedNumber >= blockNumber && verifyFinalizedNumber >= blockNumber) {
      return { latest, finalized: finalizedNumber, verifyFinalized: verifyFinalizedNumber }
    }
    await sleep(400)
  }
  die(`timed out waiting for tx block ${blockNumber} to finalize on both providers and age past Monad k=3 window`)
}

function txData(t) {
  const data = t.input ?? t.data
  if (!data || !String(data).startsWith('0x')) die('transaction calldata/initcode is missing')
  return data
}

function txRequest(t, gas = null) {
  const req = {
    from: EXPECTED_DEPLOYER,
    data: txData(t),
    value: hex(asBigInt(t.value ?? '0x0', 'transaction value')),
  }
  if (t.to) req.to = t.to
  if (gas != null) req.gas = hex(gas)
  return req
}

function withGasMargin(estimate, reviewedGas = 0n) {
  const padded = (estimate * GAS_MARGIN_NUM + GAS_MARGIN_DEN - 1n) / GAS_MARGIN_DEN
  const selected = padded > reviewedGas ? padded : reviewedGas
  if (selected <= estimate) die(`selected gas ${selected} does not exceed estimate ${estimate}`)
  if (selected >= MAX_MONAD_GAS) die(`selected gas ${selected} is not below Monad 30,000,000 limit`)
  return selected
}

async function estimateAndSimulate(t, label) {
  const req = txRequest(t)
  const [submissionRaw, verificationRaw] = await Promise.all([
    rpc('eth_estimateGas', [req]),
    verifyRpc('eth_estimateGas', [req]),
  ])
  const submission = asBigInt(submissionRaw, `${label} submission gas estimate`)
  const verification = asBigInt(verificationRaw, `${label} verification gas estimate`)
  const estimate = submission > verification ? submission : verification
  const reviewedGas = asBigInt(t.gas ?? 0, `${label} reviewed gas`)
  const gas = withGasMargin(estimate, reviewedGas)
  const simReq = txRequest(t, gas)
  await Promise.all([
    rpc('eth_call', [simReq, 'latest']),
    verifyRpc('eth_call', [simReq, 'latest']),
  ])
  return { submission, verification, estimate, reviewedGas, gas }
}

function buildSignedTx(t) {
  const nonce = asBigInt(t.nonce, 'nonce')
  const gas = asBigInt(t.gas, 'gas')
  const value = asBigInt(t.value ?? '0x0', 'value')
  const data = txData(t)
  if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) die(`nonce ${nonce} exceeds safe integer range`)

  const tx = {
    chainId: 143,
    gas,
    maxFeePerGas: MAX_FEE_PER_GAS,
    maxPriorityFeePerGas: PRIORITY_FEE_PER_GAS,
    nonce: Number(nonce),
    value,
    data,
    accessList: [],
  }
  if (t.to) tx.to = t.to

  const unsigned = serializeTransaction(tx)
  const digest = keccak256(unsigned)
  const signature = runCast([
    'wallet', 'sign', '--no-hash', digest,
    '--account', account,
    '--password-file', passwordFile,
  ])
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    die(`nonce ${nonce}: cast wallet sign did not return a 65-byte signature`)
  }
  const body = signature.slice(2)
  const r = `0x${body.slice(0, 64)}`
  const s = `0x${body.slice(64, 128)}`
  const v = Number.parseInt(body.slice(128, 130), 16)
  const yParity = v === 27 || v === 0 ? 0 : v === 28 || v === 1 ? 1 : null
  if (yParity == null) die(`nonce ${nonce}: unexpected signature recovery byte ${v}`)

  const raw = serializeTransaction(tx, { r, s, yParity })
  if (!/^0x[0-9a-fA-F]+$/.test(raw)) die(`nonce ${nonce}: viem did not return a raw signed transaction`)
  return raw
}

function validateArtifact(artifact) {
  if (!Array.isArray(artifact.transactions) || artifact.transactions.length !== EXPECTED_ARTIFACT_TX_COUNT) {
    die(`expected ${EXPECTED_ARTIFACT_TX_COUNT} artifact transactions`)
  }
  if ((artifact.receipts?.length ?? 0) !== 0) die('reviewed Foundry artifact unexpectedly contains receipts')
  if ((artifact.pending?.length ?? 0) !== 0) die('reviewed Foundry artifact unexpectedly contains pending entries')

  let totalGas = 0n
  let maxGas = 0n
  for (let i = 0; i < artifact.transactions.length; i++) {
    const t = artifact.transactions[i].transaction || {}
    const nonce = asBigInt(t.nonce, `artifact tx ${i + 1} nonce`)
    const gas = asBigInt(t.gas, `artifact tx ${i + 1} gas`)
    const expectedNonce = 175n + BigInt(i)
    if (nonce !== expectedNonce) die(`artifact tx ${i + 1}: nonce ${nonce} != ${expectedNonce}`)
    if (lower(t.from) !== lower(EXPECTED_DEPLOYER)) die(`artifact tx ${i + 1}: unexpected sender ${t.from}`)
    totalGas += gas
    if (gas > maxGas) maxGas = gas
  }
  if (totalGas !== EXPECTED_ARTIFACT_TOTAL_GAS) die(`artifact gas total ${totalGas} changed`)
  if (maxGas !== EXPECTED_ARTIFACT_MAX_GAS) die(`artifact max gas ${maxGas} changed`)

  const txs = artifact.transactions.map((entry) => entry.transaction)
  const [tx7, tx8, tx9, tx10] = [txs[6], txs[7], txs[8], txs[9]]
  if (
    asBigInt(tx7.gas, 'tx7 gas') !== 28_730n ||
    asBigInt(tx8.gas, 'tx8 gas') !== 30_197n ||
    asBigInt(tx9.gas, 'tx9 gas') !== 30_823n ||
    asBigInt(tx10.gas, 'tx10 gas') !== 30_182n
  ) {
    die('artifact tx7..tx10 gas values changed from the reviewed incident artifact')
  }

  const expected7 = encodeFunctionData({ abi: paintAbi, functionName: 'setPainterPass', args: [PASS] })
  const expected8 = encodeFunctionData({ abi: paintAbi, functionName: 'addRenderer', args: [DIFF, 'diff'] })
  const expected9 = encodeFunctionData({ abi: paintAbi, functionName: 'addRenderer', args: [TIMELAPSE, 'season timelapse'] })
  const expected10 = encodeFunctionData({ abi: paintAbi, functionName: 'addRenderer', args: [DF1, 'df1'] })
  for (const [label, actual, expected] of [
    ['tx7 setPainterPass', txData(tx7), expected7],
    ['tx8 addRenderer(diff)', txData(tx8), expected8],
    ['tx9 addRenderer(timelapse)', txData(tx9), expected9],
    ['tx10 addRenderer(df1)', txData(tx10), expected10],
  ]) {
    if (lower(actual) !== lower(expected)) die(`${label} calldata changed`)
  }
  return txs
}

function validateOriginalJournal(journal) {
  if (journal.schema !== 'r3os-core-manual-broadcast/v1') die(`unexpected original journal schema ${journal.schema}`)
  if (lower(journal.manifestHash) !== lower(EXPECTED_MANIFEST)) die('original journal manifest hash changed')
  if (lower(journal.deployer) !== lower(EXPECTED_DEPLOYER)) die('original journal deployer changed')
  if (!Array.isArray(journal.entries) || journal.entries.length !== 7) {
    die(`original journal must contain exactly 7 incident entries; found ${journal.entries?.length}`)
  }
  for (let i = 0; i < 7; i++) {
    const entry = journal.entries[i]
    const expectedState = i < 6 ? 'FINALIZED' : 'REVERTED'
    if (entry.index !== i + 1) die(`original journal entry ${i + 1}: index mismatch`)
    if (asBigInt(entry.nonce, `journal entry ${i + 1} nonce`) !== 175n + BigInt(i)) {
      die(`original journal entry ${i + 1}: nonce mismatch`)
    }
    if (entry.state !== expectedState) die(`original journal entry ${i + 1}: state ${entry.state} != ${expectedState}`)
    if (lower(entry.sentHash) !== lower(INCIDENT_HASHES[i])) die(`original journal entry ${i + 1}: tx hash mismatch`)
  }
  const failed = journal.entries[6]
  if (failed.receipt?.status !== '0x0') die('original journal tx7 receipt is not reverted')
  if (asBigInt(failed.gas, 'original tx7 gas') !== 28_730n) die('original journal tx7 gas changed')
}

function buildRecoveryBatch(txs) {
  const executionCalldata = encodeAbiParameters(
    [{
      type: 'tuple[]',
      components: [
        { name: 'target', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'callData', type: 'bytes' },
      ],
    }],
    [[
      { target: PAINT, value: 0n, callData: txData(txs[6]) },
      { target: PAINT, value: 0n, callData: txData(txs[7]) },
    ]],
  )
  const data = encodeFunctionData({
    abi: delegatorAbi,
    functionName: 'execute',
    args: [MODE_BATCH, executionCalldata],
  })
  if (lower(keccak256(data)) !== lower(EXPECTED_BATCH_DATA_HASH)) die('recovery batch calldata hash changed')
  return {
    from: EXPECTED_DEPLOYER,
    to: EXPECTED_DEPLOYER,
    nonce: '182',
    value: '0x0',
    input: data,
    gas: '0',
  }
}

async function callContract(url, to, abi, functionName, args = []) {
  const data = encodeFunctionData({ abi, functionName, args })
  const raw = await rpcAt(url, 'eth_call', [{ to, data }, 'latest'])
  return decodeFunctionResult({ abi, functionName, data: raw })
}

async function assertCodeState(url, expectedPresent, expectedEmpty) {
  for (const [name, address] of expectedPresent) {
    const code = await rpcAt(url, 'eth_getCode', [address, 'latest'])
    if (!code || code === '0x') die(`${name} code missing at ${address}`)
  }
  for (const [name, address] of expectedEmpty) {
    const code = await rpcAt(url, 'eth_getCode', [address, 'latest'])
    if (code !== '0x') die(`${name} predicted address is no longer empty: ${address}`)
  }
}

async function assertIncidentState() {
  const [chainIdRaw, verifyChainIdRaw] = await Promise.all([
    rpc('eth_chainId'),
    verifyRpc('eth_chainId'),
  ])
  const chainId = asBigInt(chainIdRaw, 'submission chain id')
  const verifyChainId = asBigInt(verifyChainIdRaw, 'verification chain id')
  if (chainId !== 143n || verifyChainId !== 143n) die(`wrong chain: ${chainId}/${verifyChainId}`)

  const [latestRaw, pendingRaw, verifyLatestRaw] = await Promise.all([
    rpc('eth_getTransactionCount', [EXPECTED_DEPLOYER, 'latest']),
    rpc('eth_getTransactionCount', [EXPECTED_DEPLOYER, 'pending']),
    verifyRpc('eth_getTransactionCount', [EXPECTED_DEPLOYER, 'latest']),
  ])
  const latest = asBigInt(latestRaw, 'latest nonce')
  const pending = asBigInt(pendingRaw, 'pending nonce')
  const verifyLatest = asBigInt(verifyLatestRaw, 'verification latest nonce')
  if (latest !== 182n || pending !== 182n || verifyLatest !== 182n) {
    die(`expected incident nonce 182; got submission ${latest}/${pending}, verification ${verifyLatest}`)
  }

  const expectedDelegation = `0xef0100${DELEGATOR.slice(2).toLowerCase()}`
  const [delegationCode, verifyDelegationCode] = await Promise.all([
    rpc('eth_getCode', [EXPECTED_DEPLOYER, 'latest']),
    verifyRpc('eth_getCode', [EXPECTED_DEPLOYER, 'latest']),
  ])
  if (lower(delegationCode) !== expectedDelegation || lower(verifyDelegationCode) !== expectedDelegation) {
    die(`deployer EIP-7702 delegation designator changed`)
  }

  const present = [
    ['Paint', PAINT], ['Labs', LABS], ['DiffRenderer', DIFF], ['SeasonTimelapseRenderer', TIMELAPSE],
    ['DF1Renderer', DF1], ['PainterPass', PASS],
  ]
  const empty = [
    ['FinaleAuction', AUCTION], ['Quests', QUESTS], ['RecycleBin', RECYCLE], ['CDBurner', CDBURNER],
  ]
  await Promise.all([
    assertCodeState(rpcUrl, present, empty),
    assertCodeState(verifyRpcUrl, present, empty),
  ])

  const [owner, painterPass, rendererCount, linkedPaint, supportsBatch] = await Promise.all([
    callContract(rpcUrl, PAINT, paintAbi, 'owner'),
    callContract(rpcUrl, PAINT, paintAbi, 'painterPass'),
    callContract(rpcUrl, PAINT, paintAbi, 'rendererCount'),
    callContract(rpcUrl, PASS, passAbi, 'PAINT'),
    callContract(rpcUrl, EXPECTED_DEPLOYER, delegatorAbi, 'supportsExecutionMode', [MODE_BATCH]),
  ])
  if (lower(owner) !== lower(EXPECTED_DEPLOYER)) die(`Paint owner changed: ${owner}`)
  if (lower(painterPass) !== '0x0000000000000000000000000000000000000000') die(`painterPass already changed: ${painterPass}`)
  if (rendererCount !== 1n) die(`rendererCount is ${rendererCount}, expected 1`)
  if (lower(linkedPaint) !== lower(PAINT)) die(`PainterPass.PAINT changed: ${linkedPaint}`)
  if (!supportsBatch) die('deployer delegation no longer supports batch execution mode')

  const balance = asBigInt(await rpc('eth_getBalance', [EXPECTED_DEPLOYER, 'latest']), 'deployer balance')
  if (balance < MIN_BALANCE) die(`deployer balance unexpectedly low: ${balance}`)

  const [latestBlock, verifyBlock] = await Promise.all([
    rpc('eth_getBlockByNumber', ['latest', false]),
    verifyRpc('eth_getBlockByNumber', ['latest', false]),
  ])
  const baseFee = asBigInt(latestBlock.baseFeePerGas, 'submission base fee')
  const verifyBaseFee = asBigInt(verifyBlock.baseFeePerGas, 'verification base fee')
  if (baseFee + PRIORITY_FEE_PER_GAS > MAX_FEE_PER_GAS || verifyBaseFee + PRIORITY_FEE_PER_GAS > MAX_FEE_PER_GAS) {
    die(`base fee moved above approved 205 gwei cap`)
  }

  return { chainId, latest, pending, verifyLatest, balance, baseFee, verifyBaseFee }
}

async function assertNonce(expected) {
  const [latestRaw, pendingRaw, verifyLatestRaw] = await Promise.all([
    rpc('eth_getTransactionCount', [EXPECTED_DEPLOYER, 'latest']),
    rpc('eth_getTransactionCount', [EXPECTED_DEPLOYER, 'pending']),
    verifyRpc('eth_getTransactionCount', [EXPECTED_DEPLOYER, 'latest']),
  ])
  const latest = asBigInt(latestRaw, 'latest nonce')
  const pending = asBigInt(pendingRaw, 'pending nonce')
  const verifyLatest = asBigInt(verifyLatestRaw, 'verification latest nonce')
  if (latest !== expected || pending !== expected || verifyLatest !== expected) {
    die(`nonce drift: expected ${expected}, submission=${latest}/${pending}, verification=${verifyLatest}`)
  }
}

async function assertFeeAndBalance(gas) {
  const [latestBlock, verifyBlock, balanceRaw] = await Promise.all([
    rpc('eth_getBlockByNumber', ['latest', false]),
    verifyRpc('eth_getBlockByNumber', ['latest', false]),
    rpc('eth_getBalance', [EXPECTED_DEPLOYER, 'latest']),
  ])
  const baseFee = asBigInt(latestBlock.baseFeePerGas, 'submission base fee')
  const verifyBaseFee = asBigInt(verifyBlock.baseFeePerGas, 'verification base fee')
  if (baseFee + PRIORITY_FEE_PER_GAS > MAX_FEE_PER_GAS || verifyBaseFee + PRIORITY_FEE_PER_GAS > MAX_FEE_PER_GAS) {
    die(`base fee moved above approved 205 gwei cap`)
  }
  const balance = asBigInt(balanceRaw, 'deployer balance')
  const envelope = gas * MAX_FEE_PER_GAS
  if (balance < envelope + 5n * MON) die(`balance ${balance} too low for tx envelope ${envelope} plus 5 MON reserve`)
}

async function assertPostStep(step) {
  if (step.kind === 'recovery-batch') {
    const [painterPass, rendererCount] = await Promise.all([
      callContract(rpcUrl, PAINT, paintAbi, 'painterPass'),
      callContract(rpcUrl, PAINT, paintAbi, 'rendererCount'),
    ])
    if (lower(painterPass) !== lower(PASS)) die(`recovery batch finalized but painterPass=${painterPass}`)
    if (rendererCount !== 2n) die(`recovery batch finalized but rendererCount=${rendererCount}, expected 2`)
  } else if (step.artifactTx === 9) {
    const count = await callContract(rpcUrl, PAINT, paintAbi, 'rendererCount')
    if (count !== 3n) die(`tx9 finalized but rendererCount=${count}, expected 3`)
  } else if (step.artifactTx === 10) {
    const count = await callContract(rpcUrl, PAINT, paintAbi, 'rendererCount')
    if (count !== 4n) die(`tx10 finalized but rendererCount=${count}, expected 4`)
  }
}

async function finalAssertions() {
  await assertNonce(EXPECTED_FINAL_NONCE)

  const allContracts = [
    ['Paint', PAINT], ['Labs', LABS], ['DiffRenderer', DIFF], ['SeasonTimelapseRenderer', TIMELAPSE],
    ['DF1Renderer', DF1], ['PainterPass', PASS], ['FinaleAuction', AUCTION], ['Quests', QUESTS],
    ['RecycleBin', RECYCLE], ['CDBurner', CDBURNER],
  ]
  await Promise.all([
    assertCodeState(rpcUrl, allContracts, []),
    assertCodeState(verifyRpcUrl, allContracts, []),
  ])

  const [paintOwner, labsOwner, passOwner, questsOwner, painterPass, rendererCount, experimentCount,
    stampSourceCount, stamp0, stamp1, questCount, recycleExperimentId, cdExperimentId] = await Promise.all([
    callContract(rpcUrl, PAINT, paintAbi, 'owner'),
    callContract(rpcUrl, LABS, ownableAbi, 'owner'),
    callContract(rpcUrl, PASS, passAbi, 'owner'),
    callContract(rpcUrl, QUESTS, questsAbi, 'owner'),
    callContract(rpcUrl, PAINT, paintAbi, 'painterPass'),
    callContract(rpcUrl, PAINT, paintAbi, 'rendererCount'),
    callContract(rpcUrl, PAINT, paintAbi, 'experimentCount'),
    callContract(rpcUrl, PASS, passAbi, 'stampSourceCount'),
    callContract(rpcUrl, PASS, passAbi, 'stampSource', [0n]),
    callContract(rpcUrl, PASS, passAbi, 'stampSource', [1n]),
    callContract(rpcUrl, QUESTS, questsAbi, 'questCount'),
    callContract(rpcUrl, RECYCLE, experimentIdAbi, 'experimentId'),
    callContract(rpcUrl, CDBURNER, experimentIdAbi, 'experimentId'),
  ])
  for (const [name, owner] of [['Paint', paintOwner], ['Labs', labsOwner], ['Pass', passOwner], ['Quests', questsOwner]]) {
    if (lower(owner) !== lower(EXPECTED_DEPLOYER)) die(`${name} owner is ${owner}, expected deployer`)
  }
  if (lower(painterPass) !== lower(PASS)) die(`final painterPass is ${painterPass}`)
  if (rendererCount !== 4n) die(`final rendererCount=${rendererCount}, expected 4`)
  if (experimentCount !== 4n) die(`final experimentCount=${experimentCount}, expected 4`)
  if (stampSourceCount !== 2n) die(`final stampSourceCount=${stampSourceCount}, expected 2`)
  if (lower(stamp0) !== lower(QUESTS) || lower(stamp1) !== lower(RECYCLE)) {
    die(`final stamp sources are ${stamp0}, ${stamp1}; expected Quests, RecycleBin`)
  }
  if (questCount !== 7n) die(`final questCount=${questCount}, expected 7`)
  if (recycleExperimentId !== 2n) die(`RecycleBin experimentId=${recycleExperimentId}, expected 2`)
  if (cdExperimentId !== 3n) die(`CDBurner experimentId=${cdExperimentId}, expected 3`)
}

function recoverySteps(txs, batch) {
  const steps = [{
    kind: 'recovery-batch',
    label: 'RECOVER tx7+tx8: setPainterPass + addRenderer(diff)',
    artifactTxs: [7, 8],
    artifactTx: null,
    tx: batch,
  }]
  for (let artifactIndex = 8; artifactIndex < txs.length; artifactIndex++) {
    const artifactTx = artifactIndex + 1
    steps.push({
      kind: 'artifact',
      label: `artifact tx${artifactTx}`,
      artifactTxs: [artifactTx],
      artifactTx,
      tx: { ...txs[artifactIndex] },
    })
  }
  if (steps.length !== 22) die(`internal recovery step count ${steps.length} != 22`)
  if (asBigInt(steps[0].tx.nonce, 'batch nonce') !== 182n) die('batch nonce is not 182')
  if (asBigInt(steps.at(-1).tx.nonce, 'last nonce') !== 203n) die('last recovery nonce is not 203')
  return steps
}

async function prepareStep(step) {
  const nonce = asBigInt(step.tx.nonce, `${step.label} nonce`)
  await assertNonce(nonce)

  if (!step.tx.to) {
    const expectedAddress = CREATE_EXPECTED_BY_NONCE.get(nonce)
    if (expectedAddress) {
      const [submissionCode, verificationCode] = await Promise.all([
        rpc('eth_getCode', [expectedAddress, 'latest']),
        verifyRpc('eth_getCode', [expectedAddress, 'latest']),
      ])
      if (submissionCode !== '0x' || verificationCode !== '0x') {
        die(`${step.label}: predicted CREATE address ${expectedAddress} is not empty`)
      }
    }
  }

  const metrics = await estimateAndSimulate(step.tx, step.label)
  step.tx.gas = metrics.gas.toString()
  await assertFeeAndBalance(metrics.gas)
  return metrics
}

async function main() {
  if (!fs.existsSync(artifactPath)) die(`missing ${artifactPath}`)
  if (!fs.existsSync(originalJournalPath)) die(`missing incident journal ${originalJournalPath}`)

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  const txs = validateArtifact(artifact)
  const originalJournal = JSON.parse(fs.readFileSync(originalJournalPath, 'utf8'))
  validateOriginalJournal(originalJournal)
  const batch = buildRecoveryBatch(txs)
  const steps = recoverySteps(txs, batch)
  const live = await assertIncidentState()

  // Establish the exact recovery transaction's live dual-provider estimate and simulation.
  const firstMetrics = await estimateAndSimulate(batch, 'recovery batch')
  batch.gas = firstMetrics.gas.toString()

  console.log('\nr3OS CORE RECOVERY CHECK')
  console.log(`manifest:              ${EXPECTED_MANIFEST}`)
  console.log(`incident tx:           ${EXPECTED_FAILED_TX}`)
  console.log(`chain:                 ${live.chainId}`)
  console.log(`nonce latest/pending:  ${live.latest}/${live.pending}`)
  console.log(`deployer delegation:   ${DELEGATOR}`)
  console.log(`recovery batch hash:   ${EXPECTED_BATCH_DATA_HASH}`)
  console.log(`recovery steps:        ${steps.length} (nonce 182..203)`)
  console.log(`final expected nonce:  ${EXPECTED_FINAL_NONCE}`)
  console.log(`batch estimate sub/ver:${firstMetrics.submission}/${firstMetrics.verification}`)
  console.log(`batch selected gas:    ${firstMetrics.gas} (${GAS_MARGIN_NUM}% max-provider estimate floor)`)
  console.log(`base fee sub/ver:      ${Number(live.baseFee) / 1e9}/${Number(live.verifyBaseFee) / 1e9} gwei`)
  console.log(`fee cap / priority:    205 / 2 gwei`)
  console.log(`mode:                  ${mode.toUpperCase()}`)

  if (mode === 'check') {
    console.log('\nREADY FOR RECOVERY SIGN-CHECK: all incident-state and batch simulations passed.')
    console.log('No transaction was signed or sent.')
    return
  }

  if (!passwordFile) die('R3OS_KEYSTORE_PASSWORD_FILE is not set')
  if (!fs.existsSync(passwordFile)) die(`keystore password file does not exist: ${passwordFile}`)
  const signer = runCast(['wallet', 'address', '--account', account, '--password-file', passwordFile]).split(/\s+/).at(-1)
  if (lower(signer) !== lower(EXPECTED_DEPLOYER)) {
    die(`keystore ${account} resolves to ${signer}, expected ${EXPECTED_DEPLOYER}`)
  }

  if (mode === 'sign-check') {
    const raw = buildSignedTx(batch)
    const preparedHash = keccak256(raw)
    console.log(`\nRECOVERY SIGN-CHECK PASSED: nonce 182 batch signed locally as ${preparedHash}`)
    console.log(`selected gas: ${batch.gas}`)
    console.log('No transaction was submitted. Raw signed transaction was not printed or stored.')
    return
  }

  if (process.env.CONFIRM_MAINNET !== 'true') {
    die('recovery broadcast requires CONFIRM_MAINNET=true on this exact command')
  }
  if (process.env.CONFIRM_CORE_RECOVERY !== 'NONCE_182_PRESERVE_CREATE_ADDRESSES') {
    die('recovery broadcast requires CONFIRM_CORE_RECOVERY=NONCE_182_PRESERVE_CREATE_ADDRESSES')
  }
  if (fs.existsSync(recoveryJournalPath)) {
    die(`recovery journal already exists: ${recoveryJournalPath}. Do not delete it blindly.`)
  }

  const journal = {
    schema: 'r3os-core-recovery-broadcast/v1',
    manifestHash: EXPECTED_MANIFEST,
    incidentTx: EXPECTED_FAILED_TX,
    originalJournal: path.basename(originalJournalPath),
    rpcUrlStored: false,
    deployer: EXPECTED_DEPLOYER,
    account,
    maxFeePerGas: MAX_FEE_PER_GAS.toString(),
    priorityFeePerGas: PRIORITY_FEE_PER_GAS.toString(),
    gasMarginPercent: Number(GAS_MARGIN_NUM),
    startedAt: new Date().toISOString(),
    entries: [],
  }
  atomicWrite(recoveryJournalPath, journal)

  console.log('\nREAL CORE RECOVERY BROADCAST STARTING')
  console.log('Nonce 182 batches original tx7+tx8; original tx9..tx29 then retain nonces 183..203.')
  console.log('Every step is dual-provider estimated + simulated, sent singly, finalized, and journaled.\n')

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    // Re-estimate against the state produced by the previous finalized step.
    const metrics = await prepareStep(step)
    const nonce = asBigInt(step.tx.nonce, `${step.label} nonce`)
    const maxCost = Number(metrics.gas * MAX_FEE_PER_GAS) / 1e18

    console.log(`[${i + 1}/${steps.length}] nonce ${nonce} ${step.label}`)
    console.log(`  gas reviewed/est(sub/ver)/selected: ${metrics.reviewedGas}/${metrics.submission}/${metrics.verification}/${metrics.gas}`)
    console.log(`  max fee envelope: ${maxCost} MON`)

    const raw = buildSignedTx(step.tx)
    const preparedHash = keccak256(raw)
    const entry = {
      recoveryIndex: i + 1,
      kind: step.kind,
      label: step.label,
      sourceArtifactTxs: step.artifactTxs,
      nonce: nonce.toString(),
      to: step.tx.to ?? null,
      reviewedGas: metrics.reviewedGas.toString(),
      estimateSubmission: metrics.submission.toString(),
      estimateVerification: metrics.verification.toString(),
      selectedGas: metrics.gas.toString(),
      preparedHash,
      state: 'PREPARED',
      preparedAt: new Date().toISOString(),
    }
    journal.entries.push(entry)
    atomicWrite(recoveryJournalPath, journal)

    let sentHash
    try {
      sentHash = await rpc('eth_sendRawTransaction', [raw])
    } catch (error) {
      entry.state = 'SEND_ERROR'
      entry.error = String(error?.message ?? error)
      atomicWrite(recoveryJournalPath, journal)
      throw error
    }
    if (lower(sentHash) !== lower(preparedHash)) {
      entry.state = 'HASH_MISMATCH'
      entry.sentHash = sentHash
      atomicWrite(recoveryJournalPath, journal)
      die(`${step.label}: RPC hash ${sentHash} != locally prepared hash ${preparedHash}`)
    }

    entry.state = 'SENT'
    entry.sentHash = sentHash
    entry.sentAt = new Date().toISOString()
    atomicWrite(recoveryJournalPath, journal)
    console.log(`  sent ${sentHash}`)

    const receipt = await waitForReceipt(sentHash)
    entry.receipt = {
      status: receipt.status,
      blockNumber: receipt.blockNumber,
      contractAddress: receipt.contractAddress ?? null,
      gasUsed: receipt.gasUsed ?? null,
    }
    if (receipt.status !== '0x1') {
      entry.state = 'REVERTED'
      atomicWrite(recoveryJournalPath, journal)
      die(`${step.label} reverted: ${sentHash}`)
    }

    const receiptBlock = asBigInt(receipt.blockNumber, 'receipt block')
    if (!step.tx.to) {
      const expectedAddress = CREATE_EXPECTED_BY_NONCE.get(nonce)
      if (expectedAddress && lower(receipt.contractAddress) !== lower(expectedAddress)) {
        entry.state = 'CREATE_ADDRESS_MISMATCH'
        atomicWrite(recoveryJournalPath, journal)
        die(`${step.label}: created ${receipt.contractAddress}, expected ${expectedAddress}`)
      }
    }

    entry.state = 'INCLUDED'
    atomicWrite(recoveryJournalPath, journal)
    console.log(`  included block ${receiptBlock}${receipt.contractAddress ? ` contract ${receipt.contractAddress}` : ''}`)

    const aged = await waitUntilFinalAndClear(receiptBlock)
    entry.state = 'FINALIZED'
    entry.finalizedAt = new Date().toISOString()
    entry.finalizedBlockObserved = aged.finalized.toString()
    entry.verificationFinalizedBlockObserved = aged.verifyFinalized.toString()
    entry.latestBlockObserved = aged.latest.toString()
    atomicWrite(recoveryJournalPath, journal)

    await assertNonce(nonce + 1n)
    await assertPostStep(step)
    console.log(`  finalized; reserve window cleared; nonce now ${nonce + 1n}\n`)
  }

  await finalAssertions()
  journal.completedAt = new Date().toISOString()
  journal.state = 'COMPLETE'
  journal.finalNonce = EXPECTED_FINAL_NONCE.toString()
  atomicWrite(recoveryJournalPath, journal)

  console.log('CORE RECOVERY COMPLETE: 22/22 recovery transactions finalized.')
  console.log(`final nonce: ${EXPECTED_FINAL_NONCE}`)
  console.log(`journal: ${recoveryJournalPath}`)
  console.log('STOP HERE. CORE state is repaired; do not start CARD.DRV yet.')
}

main().catch((error) => {
  console.error(`\nRECOVERY STOPPED: ${error.message}`)
  console.error(`original journal: ${originalJournalPath}`)
  console.error(`recovery journal: ${recoveryJournalPath}`)
  console.error('Do not rerun, do not use Forge --resume, and do not send another deployer transaction until this state is reviewed.')
  process.exit(1)
})
