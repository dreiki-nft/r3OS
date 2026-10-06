#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  decodeFunctionResult,
  encodeFunctionData,
  getContractAddress,
  keccak256,
  parseAbi,
  serializeTransaction,
} from 'viem'

const DEPLOYER = '0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA'
const PAINT = '0x5102DE3817aE16b3afaEb9D180130669A70787b3'
const OPERATOR_RECORD = '0xEd7c82243C63eB1Cf51E1210f7846b4EC8725A6E'
const SYSTEM_EVENT = '0xB93A2b18437A1f169D39D81aAD19b074D6292066'
const ROUTER_LAB = '0x1206cD64b805fA612C49DC0296c8813248428661'

const FIRST_NONCE = 217n
const FINAL_NONCE = 219n
const EXPECTED_GAS = [2_147_749n, 114_259n]
const ROUTER_INITCODE_HASH = '0x09bd114d384b9e80abb414816d9fdfecc00bb32db037375036d98d1f4bca460c'

const MAX_FEE_PER_GAS = 205_000_000_000n
const PRIORITY_FEE_PER_GAS = 2_000_000_000n
const CREATE_GAS_MARGIN_NUM = 150n
const CALL_GAS_MARGIN_NUM = 175n
const GAS_MARGIN_DEN = 100n
const MAX_MONAD_GAS = 30_000_000n
const MON = 10n ** 18n
const MIN_BALANCE = 5n * MON

const mode = process.argv.includes('--broadcast')
  ? 'broadcast'
  : process.argv.includes('--sign-check')
    ? 'sign-check'
    : 'check'

const cwd = process.cwd()
const artifactPath = path.resolve(cwd, 'broadcast/DeployRouterLab.s.sol/143/dry-run/run-latest.json')
const journalPath = path.resolve(cwd, '../artifacts/mainnet-router-lab-broadcast-journal.json')
const rpcUrl = process.env.RPC_URL || 'https://rpc.monad.xyz'
const verifyRpcUrl = process.env.VERIFY_RPC_URL || 'https://rpc.monad.xyz'
const account = process.env.R3OS_KEYSTORE_ACCOUNT || 'r3os-deployer'
const passwordFile = process.env.R3OS_KEYSTORE_PASSWORD_FILE || ''

const paintAbi = parseAbi([
  'function owner() view returns (address)',
  'function experimentCount() view returns (uint256)',
  'function experimentsFrozen() view returns (bool)',
  'function addExperiment(address experiment,string name,string uri) returns (uint256)',
  'function experimentInfo(uint256 experimentId) view returns ((address experiment,string name,string uri,bool retired))',
])

const routerAbi = parseAbi([
  'function MAX_VENUES() view returns (uint256)',
  'function MIN_GAS_PER_FRAME() view returns (uint256)',
  'function MAX_GAS_PER_FRAME() view returns (uint256)',
  'function FRAME_OVERHEAD() view returns (uint256)',
  'function MAX_REVERT_COPY() view returns (uint256)',
  'function MAX_SUCCESS_RETURN() view returns (uint256)',
  'function INTERFACE() view returns (string)',
])

function die(message) {
  console.error(`\nABORT: ${message}`)
  process.exit(1)
}

function lower(value) {
  return String(value ?? '').toLowerCase()
}

function asBigInt(value, label) {
  if (value == null) die(`${label} is missing`)
  try {
    return BigInt(value)
  } catch {
    die(`${label} is not an integer: ${value}`)
  }
}

function hex(value) {
  return `0x${BigInt(value).toString(16)}`
}

function txData(t) {
  const data = t.input ?? t.data
  if (!data || !String(data).startsWith('0x')) die('transaction calldata/initcode is missing')
  return data
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

async function callContract(url, to, abi, functionName, args = []) {
  const data = encodeFunctionData({ abi, functionName, args })
  const raw = await rpcAt(url, 'eth_call', [{ to, data }, 'latest'])
  return decodeFunctionResult({ abi, functionName, data: raw })
}

function normalizeExperimentInfo(info) {
  if (Array.isArray(info)) {
    return { experiment: info[0], name: info[1], uri: info[2], retired: info[3] }
  }
  if (info && typeof info === 'object') {
    return {
      experiment: info.experiment ?? info[0],
      name: info.name ?? info[1],
      uri: info.uri ?? info[2],
      retired: info.retired ?? info[3],
    }
  }
  die(`unexpected experimentInfo decode: ${String(info)}`)
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
    const verifyFinalizedNumber = verifyFinalized ? asBigInt(verifyFinalized.number, 'verification finalized block') : 0n
    if (latest >= target && finalizedNumber >= blockNumber && verifyFinalizedNumber >= blockNumber) {
      return { latest, finalized: finalizedNumber, verifyFinalized: verifyFinalizedNumber }
    }
    await sleep(400)
  }
  die(`timed out waiting for tx block ${blockNumber} to finalize on both providers and age past Monad k=3 window`)
}

function expectedRegistrationCall() {
  return encodeFunctionData({
    abi: paintAbi,
    functionName: 'addExperiment',
    args: [ROUTER_LAB, 'router-lab', ''],
  })
}

function validateArtifact(artifact) {
  const txEntries = artifact.transactions ?? []
  if (!Array.isArray(txEntries) || txEntries.length !== 2) die(`expected 2 Router Lab transactions, found ${txEntries.length}`)
  if ((artifact.receipts?.length ?? 0) !== 0) die('Router Lab dry-run artifact unexpectedly contains receipts')
  if ((artifact.pending?.length ?? 0) !== 0) die('Router Lab dry-run artifact unexpectedly contains pending entries')

  const txs = txEntries.map((entry) => entry.transaction || {})
  for (let i = 0; i < txs.length; i++) {
    const t = txs[i]
    const nonce = asBigInt(t.nonce, `tx${i + 1} nonce`)
    const gas = asBigInt(t.gas, `tx${i + 1} gas`)
    if (nonce !== FIRST_NONCE + BigInt(i)) die(`tx${i + 1}: nonce ${nonce} changed`)
    if (gas !== EXPECTED_GAS[i]) die(`tx${i + 1}: reviewed gas ${gas} != ${EXPECTED_GAS[i]}`)
    t._reviewedGas = gas.toString()
    if (lower(t.from) !== lower(DEPLOYER)) die(`tx${i + 1}: sender ${t.from} != deployer`)
    if (asBigInt(t.value ?? 0, `tx${i + 1} value`) !== 0n) die(`tx${i + 1}: nonzero value`)
    txData(t)
  }

  if (txs[0].to != null && txs[0].to !== '') die(`tx1 must be CREATE; got to=${txs[0].to}`)
  if (lower(txs[1].to) !== lower(PAINT)) die(`tx2 target ${txs[1].to} != Paint ${PAINT}`)

  const predicted = getContractAddress({ from: DEPLOYER, nonce: FIRST_NONCE })
  if (lower(predicted) !== lower(ROUTER_LAB)) die(`predicted RouterLab address ${predicted} != ${ROUTER_LAB}`)

  const initcodeHash = keccak256(txData(txs[0]))
  if (lower(initcodeHash) !== lower(ROUTER_INITCODE_HASH)) {
    die(`tx1 RouterLab initcode hash ${initcodeHash} != reviewed ${ROUTER_INITCODE_HASH}`)
  }

  const expectedCall = expectedRegistrationCall()
  if (lower(txData(txs[1])) !== lower(expectedCall)) die('tx2 addExperiment(router-lab) calldata changed')

  return txs
}

function txRequest(t, gas = null) {
  const req = {
    from: DEPLOYER,
    data: txData(t),
    value: hex(asBigInt(t.value ?? 0, 'transaction value')),
  }
  if (t.to) req.to = t.to
  if (gas != null) req.gas = hex(gas)
  return req
}

function withGasMargin(estimate, reviewedGas, isCreate) {
  const marginNum = isCreate ? CREATE_GAS_MARGIN_NUM : CALL_GAS_MARGIN_NUM
  const padded = (estimate * marginNum + GAS_MARGIN_DEN - 1n) / GAS_MARGIN_DEN
  const selected = padded > reviewedGas ? padded : reviewedGas
  if (selected <= estimate) die(`selected gas ${selected} does not exceed live estimate ${estimate}`)
  if (selected >= MAX_MONAD_GAS) die(`selected gas ${selected} is not below Monad 30,000,000 limit`)
  return { selected, marginNum }
}

async function estimateAndSimulate(t, label) {
  const req = txRequest(t)
  const [submissionRaw, verificationRaw] = await Promise.all([
    rpc('eth_estimateGas', [req]),
    verifyRpc('eth_estimateGas', [req]),
  ])
  const submission = asBigInt(submissionRaw, `${label} submission estimate`)
  const verification = asBigInt(verificationRaw, `${label} verification estimate`)
  const estimate = submission > verification ? submission : verification
  const reviewedGas = asBigInt(t._reviewedGas ?? t.gas, `${label} reviewed gas`)
  const { selected: gas, marginNum } = withGasMargin(estimate, reviewedGas, !t.to)
  const simReq = txRequest(t, gas)
  await Promise.all([
    rpc('eth_call', [simReq, 'latest']),
    verifyRpc('eth_call', [simReq, 'latest']),
  ])
  return { submission, verification, estimate, reviewedGas, gas, marginPercent: Number(marginNum) }
}

function buildSignedTx(t) {
  const nonce = asBigInt(t.nonce, 'nonce')
  const gas = asBigInt(t.gas, 'gas')
  const value = asBigInt(t.value ?? 0, 'value')
  if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) die(`nonce ${nonce} exceeds safe integer range`)

  const tx = {
    chainId: 143,
    gas,
    maxFeePerGas: MAX_FEE_PER_GAS,
    maxPriorityFeePerGas: PRIORITY_FEE_PER_GAS,
    nonce: Number(nonce),
    value,
    data: txData(t),
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
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) die(`nonce ${nonce}: cast wallet sign did not return a 65-byte signature`)

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

async function assertNonce(expected) {
  const [latestRaw, pendingRaw, verifyLatestRaw, verifyPendingRaw] = await Promise.all([
    rpc('eth_getTransactionCount', [DEPLOYER, 'latest']),
    rpc('eth_getTransactionCount', [DEPLOYER, 'pending']),
    verifyRpc('eth_getTransactionCount', [DEPLOYER, 'latest']),
    verifyRpc('eth_getTransactionCount', [DEPLOYER, 'pending']),
  ])
  const values = [latestRaw, pendingRaw, verifyLatestRaw, verifyPendingRaw].map((v, i) => asBigInt(v, `nonce ${i}`))
  if (values.some((v) => v !== expected)) {
    die(`nonce drift: expected ${expected}; submission=${values[0]}/${values[1]}, verification=${values[2]}/${values[3]}`)
  }
}

async function assertFeeAndBalance(gas) {
  const [latestBlock, verifyBlock, balanceRaw] = await Promise.all([
    rpc('eth_getBlockByNumber', ['latest', false]),
    verifyRpc('eth_getBlockByNumber', ['latest', false]),
    rpc('eth_getBalance', [DEPLOYER, 'latest']),
  ])
  const baseFee = asBigInt(latestBlock.baseFeePerGas, 'submission base fee')
  const verifyBaseFee = asBigInt(verifyBlock.baseFeePerGas, 'verification base fee')
  if (baseFee + PRIORITY_FEE_PER_GAS > MAX_FEE_PER_GAS || verifyBaseFee + PRIORITY_FEE_PER_GAS > MAX_FEE_PER_GAS) {
    die('base fee moved above approved 205 gwei cap')
  }
  const balance = asBigInt(balanceRaw, 'deployer balance')
  const envelope = gas * MAX_FEE_PER_GAS
  if (balance < envelope + MIN_BALANCE) die(`balance ${balance} too low for tx envelope ${envelope} plus ${MIN_BALANCE / MON} MON reserve`)
}

async function assertExperiment(id, expectedAddress, expectedName) {
  const [subRaw, verRaw] = await Promise.all([
    callContract(rpcUrl, PAINT, paintAbi, 'experimentInfo', [BigInt(id)]),
    callContract(verifyRpcUrl, PAINT, paintAbi, 'experimentInfo', [BigInt(id)]),
  ])
  const sub = normalizeExperimentInfo(subRaw)
  const ver = normalizeExperimentInfo(verRaw)
  for (const [lane, info] of [['submission', sub], ['verification', ver]]) {
    if (
      lower(info.experiment) !== lower(expectedAddress) ||
      info.name !== expectedName ||
      info.uri !== '' ||
      info.retired !== false
    ) {
      die(`${lane} experiment ${id} mismatch: ${JSON.stringify(info, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`)
    }
  }
}

async function assertRouterConstants() {
  const expected = {
    MAX_VENUES: 8n,
    MIN_GAS_PER_FRAME: 50_000n,
    MAX_GAS_PER_FRAME: 5_000_000n,
    FRAME_OVERHEAD: 60_000n,
    MAX_REVERT_COPY: 512n,
    MAX_SUCCESS_RETURN: 4_192n,
    INTERFACE: 'MRC-17 DRAFT (MIPs#91 6e4f8633)',
  }
  for (const [name, expectedValue] of Object.entries(expected)) {
    const [sub, ver] = await Promise.all([
      callContract(rpcUrl, ROUTER_LAB, routerAbi, name),
      callContract(verifyRpcUrl, ROUTER_LAB, routerAbi, name),
    ])
    if (typeof expectedValue === 'string') {
      if (sub !== expectedValue || ver !== expectedValue) die(`RouterLab.${name} mismatch: ${sub}/${ver}`)
    } else {
      if (asBigInt(sub, `RouterLab.${name}`) !== expectedValue || asBigInt(ver, `verification RouterLab.${name}`) !== expectedValue) {
        die(`RouterLab.${name} mismatch: ${sub}/${ver}, expected ${expectedValue}`)
      }
    }
  }
}

async function assertInitialState() {
  const [chainRaw, verifyChainRaw] = await Promise.all([
    rpc('eth_chainId'),
    verifyRpc('eth_chainId'),
  ])
  const chain = asBigInt(chainRaw, 'submission chainId')
  const verifyChain = asBigInt(verifyChainRaw, 'verification chainId')
  if (chain !== 143n || verifyChain !== 143n) die(`wrong chain: submission=${chain}, verification=${verifyChain}`)

  await assertNonce(FIRST_NONCE)

  const [paintSub, paintVer, opSub, opVer, eventSub, eventVer, routerSub, routerVer] = await Promise.all([
    rpc('eth_getCode', [PAINT, 'latest']),
    verifyRpc('eth_getCode', [PAINT, 'latest']),
    rpc('eth_getCode', [OPERATOR_RECORD, 'latest']),
    verifyRpc('eth_getCode', [OPERATOR_RECORD, 'latest']),
    rpc('eth_getCode', [SYSTEM_EVENT, 'latest']),
    verifyRpc('eth_getCode', [SYSTEM_EVENT, 'latest']),
    rpc('eth_getCode', [ROUTER_LAB, 'latest']),
    verifyRpc('eth_getCode', [ROUTER_LAB, 'latest']),
  ])
  if (paintSub === '0x' || paintVer === '0x') die('Paint code missing')
  if (opSub === '0x' || opVer === '0x') die('OperatorRecord predecessor code missing')
  if (eventSub === '0x' || eventVer === '0x') die('SystemEvent predecessor code missing')
  if (routerSub !== '0x' || routerVer !== '0x') die(`RouterLab predicted address ${ROUTER_LAB} is not empty`)

  const [ownerSub, ownerVer, countSub, countVer, frozenSub, frozenVer] = await Promise.all([
    callContract(rpcUrl, PAINT, paintAbi, 'owner'),
    callContract(verifyRpcUrl, PAINT, paintAbi, 'owner'),
    callContract(rpcUrl, PAINT, paintAbi, 'experimentCount'),
    callContract(verifyRpcUrl, PAINT, paintAbi, 'experimentCount'),
    callContract(rpcUrl, PAINT, paintAbi, 'experimentsFrozen'),
    callContract(verifyRpcUrl, PAINT, paintAbi, 'experimentsFrozen'),
  ])
  if (lower(ownerSub) !== lower(DEPLOYER) || lower(ownerVer) !== lower(DEPLOYER)) die(`Paint owner mismatch: ${ownerSub}/${ownerVer}`)
  if (asBigInt(countSub, 'submission experimentCount') !== 9n || asBigInt(countVer, 'verification experimentCount') !== 9n) {
    die(`experimentCount mismatch: ${countSub}/${countVer}, expected 9`)
  }
  if (frozenSub || frozenVer) die('experiment registry is frozen')

  await assertExperiment(7, OPERATOR_RECORD, 'operator-record')
  await assertExperiment(8, SYSTEM_EVENT, 'system-event')

  const [latestBlock, verifyBlock, balanceRaw] = await Promise.all([
    rpc('eth_getBlockByNumber', ['latest', false]),
    verifyRpc('eth_getBlockByNumber', ['latest', false]),
    rpc('eth_getBalance', [DEPLOYER, 'latest']),
  ])
  const baseFee = asBigInt(latestBlock.baseFeePerGas, 'submission base fee')
  const verifyBaseFee = asBigInt(verifyBlock.baseFeePerGas, 'verification base fee')
  const balance = asBigInt(balanceRaw, 'deployer balance')
  if (baseFee + PRIORITY_FEE_PER_GAS > MAX_FEE_PER_GAS || verifyBaseFee + PRIORITY_FEE_PER_GAS > MAX_FEE_PER_GAS) {
    die('base fee moved above approved 205 gwei cap')
  }
  if (balance < MIN_BALANCE) die(`deployer balance below ${MIN_BALANCE / MON} MON reserve`)

  return { chain, baseFee, verifyBaseFee, balance }
}

async function assertPostStep(index) {
  if (index === 0) {
    const [subCode, verCode, subCount, verCount] = await Promise.all([
      rpc('eth_getCode', [ROUTER_LAB, 'latest']),
      verifyRpc('eth_getCode', [ROUTER_LAB, 'latest']),
      callContract(rpcUrl, PAINT, paintAbi, 'experimentCount'),
      callContract(verifyRpcUrl, PAINT, paintAbi, 'experimentCount'),
    ])
    if (subCode === '0x' || verCode === '0x') die('RouterLab CREATE finalized but code is missing')
    if (asBigInt(subCount, 'submission experimentCount after CREATE') !== 9n || asBigInt(verCount, 'verification experimentCount after CREATE') !== 9n) {
      die(`Router CREATE unexpectedly changed experimentCount: ${subCount}/${verCount}`)
    }
    await assertRouterConstants()
  } else if (index === 1) {
    const [subCount, verCount] = await Promise.all([
      callContract(rpcUrl, PAINT, paintAbi, 'experimentCount'),
      callContract(verifyRpcUrl, PAINT, paintAbi, 'experimentCount'),
    ])
    if (asBigInt(subCount, 'submission experimentCount') !== 10n || asBigInt(verCount, 'verification experimentCount') !== 10n) {
      die(`after router-lab registration, experimentCount=${subCount}/${verCount}, expected 10`)
    }
    await assertExperiment(9, ROUTER_LAB, 'router-lab')
  }
}

async function finalAssertions() {
  await assertNonce(FINAL_NONCE)
  const [routerSub, routerVer, ownerSub, ownerVer, countSub, countVer, frozenSub, frozenVer] = await Promise.all([
    rpc('eth_getCode', [ROUTER_LAB, 'latest']),
    verifyRpc('eth_getCode', [ROUTER_LAB, 'latest']),
    callContract(rpcUrl, PAINT, paintAbi, 'owner'),
    callContract(verifyRpcUrl, PAINT, paintAbi, 'owner'),
    callContract(rpcUrl, PAINT, paintAbi, 'experimentCount'),
    callContract(verifyRpcUrl, PAINT, paintAbi, 'experimentCount'),
    callContract(rpcUrl, PAINT, paintAbi, 'experimentsFrozen'),
    callContract(verifyRpcUrl, PAINT, paintAbi, 'experimentsFrozen'),
  ])
  if (routerSub === '0x' || routerVer === '0x') die('final RouterLab code missing')
  if (lower(ownerSub) !== lower(DEPLOYER) || lower(ownerVer) !== lower(DEPLOYER)) die(`final Paint owner mismatch: ${ownerSub}/${ownerVer}`)
  if (asBigInt(countSub, 'submission final experimentCount') !== 10n || asBigInt(countVer, 'verification final experimentCount') !== 10n) {
    die(`final experimentCount=${countSub}/${countVer}, expected 10`)
  }
  if (frozenSub || frozenVer) die('experiment registry unexpectedly frozen')
  await assertRouterConstants()
  await assertExperiment(7, OPERATOR_RECORD, 'operator-record')
  await assertExperiment(8, SYSTEM_EVENT, 'system-event')
  await assertExperiment(9, ROUTER_LAB, 'router-lab')
}

async function prepareStep(t, index) {
  const nonce = FIRST_NONCE + BigInt(index)
  await assertNonce(nonce)
  if (index === 0) {
    const [a, b] = await Promise.all([
      rpc('eth_getCode', [ROUTER_LAB, 'latest']),
      verifyRpc('eth_getCode', [ROUTER_LAB, 'latest']),
    ])
    if (a !== '0x' || b !== '0x') die(`RouterLab predicted address ${ROUTER_LAB} is not empty`)
  } else if (index === 1) {
    const [countSub, countVer] = await Promise.all([
      callContract(rpcUrl, PAINT, paintAbi, 'experimentCount'),
      callContract(verifyRpcUrl, PAINT, paintAbi, 'experimentCount'),
    ])
    if (asBigInt(countSub, 'submission experimentCount before tx2') !== 9n || asBigInt(countVer, 'verification experimentCount before tx2') !== 9n) {
      die(`before tx2 experimentCount=${countSub}/${countVer}, expected 9`)
    }
    await assertRouterConstants()
  }
  const metrics = await estimateAndSimulate(t, `Router Lab tx${index + 1}`)
  t.gas = metrics.gas.toString()
  await assertFeeAndBalance(metrics.gas)
  return metrics
}

async function main() {
  if (!fs.existsSync(artifactPath)) die(`missing dry-run artifact ${artifactPath}`)
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  const txs = validateArtifact(artifact)
  const live = await assertInitialState()

  // Registration cannot be simulated honestly until RouterLab exists, so CHECK mode only simulates CREATE.
  const createMetrics = await estimateAndSimulate(txs[0], 'Router Lab tx1 CREATE')
  txs[0].gas = createMetrics.gas.toString()

  console.log('\nr3OS ROUTER LAB BROADCAST CHECK')
  console.log(`chain:                 ${live.chain}`)
  console.log(`deployer:              ${DEPLOYER}`)
  console.log(`nonce latest/pending:  ${FIRST_NONCE}/${FIRST_NONCE}`)
  console.log(`R3OSRouterLab:         ${ROUTER_LAB} (empty)`)
  console.log(`initcode hash:         ${ROUTER_INITCODE_HASH}`)
  console.log('transactions:          2 (nonce 217..218)')
  console.log(`final expected nonce:  ${FINAL_NONCE}`)
  console.log(`tx1 estimate sub/ver:  ${createMetrics.submission}/${createMetrics.verification}`)
  console.log(`tx1 reviewed/selected: ${createMetrics.reviewedGas}/${createMetrics.gas}`)
  console.log(`tx2 reviewed gas:      ${EXPECTED_GAS[1]} (live-estimated just-in-time after RouterLab exists)`)
  console.log(`base fee sub/ver:      ${Number(live.baseFee) / 1e9}/${Number(live.verifyBaseFee) / 1e9} gwei`)
  console.log('gas margin policy:     CREATE 150% / calls 175%')
  console.log('fee cap / priority:    205 / 2 gwei')
  console.log(`mode:                  ${mode.toUpperCase()}`)

  if (mode === 'check') {
    console.log('\nREADY FOR ROUTER LAB SIGN-CHECK: state, artifact, exact initcode, predicted address and CREATE simulation passed.')
    console.log('Tx2 will be dual-provider estimated+simulated just-in-time after RouterLab exists.')
    console.log('No transaction was signed or sent.')
    return
  }

  if (!passwordFile) die('R3OS_KEYSTORE_PASSWORD_FILE is not set')
  if (!fs.existsSync(passwordFile)) die(`keystore password file does not exist: ${passwordFile}`)
  const signer = runCast(['wallet', 'address', '--account', account, '--password-file', passwordFile]).split(/\s+/).at(-1)
  if (lower(signer) !== lower(DEPLOYER)) die(`keystore ${account} resolves to ${signer}, expected ${DEPLOYER}`)

  if (mode === 'sign-check') {
    const raw = buildSignedTx(txs[0])
    const preparedHash = keccak256(raw)
    console.log(`\nROUTER LAB SIGN-CHECK PASSED: tx1 nonce ${FIRST_NONCE} signed locally as ${preparedHash}`)
    console.log(`selected gas: ${txs[0].gas}`)
    console.log('No transaction was submitted. Raw signed transaction was not printed or stored.')
    return
  }

  if (process.env.CONFIRM_MAINNET !== 'true') die('Router Lab broadcast requires CONFIRM_MAINNET=true on this exact command')
  if (process.env.CONFIRM_ROUTER_LAB !== 'ROUTER_LAB_2_TX') {
    die('Router Lab broadcast requires CONFIRM_ROUTER_LAB=ROUTER_LAB_2_TX')
  }
  if (fs.existsSync(journalPath)) die(`Router Lab journal already exists: ${journalPath}. Do not delete it blindly.`)

  const journal = {
    schema: 'r3os-router-lab-broadcast/v1',
    rpcUrlStored: false,
    deployer: DEPLOYER,
    account,
    routerLab: ROUTER_LAB,
    initcodeHash: ROUTER_INITCODE_HASH,
    maxFeePerGas: MAX_FEE_PER_GAS.toString(),
    priorityFeePerGas: PRIORITY_FEE_PER_GAS.toString(),
    gasMarginPolicy: { createPercent: Number(CREATE_GAS_MARGIN_NUM), callPercent: Number(CALL_GAS_MARGIN_NUM) },
    startedAt: new Date().toISOString(),
    entries: [],
  }
  atomicWrite(journalPath, journal)

  console.log('\nREAL ROUTER LAB MAINNET BROADCAST STARTING')
  console.log('Two transactions; each is dual-provider estimated+simulated, sent singly, finalized and journaled.')
  console.log('Gas policy: CREATE uses max(reviewed, 150% live estimate); registry call uses max(reviewed, 175% live estimate).\n')

  const labels = ['CREATE R3OSRouterLab', 'addExperiment(router-lab)']

  for (let i = 0; i < txs.length; i++) {
    const t = txs[i]
    const nonce = FIRST_NONCE + BigInt(i)
    const metrics = await prepareStep(t, i)
    const maxCost = Number(metrics.gas * MAX_FEE_PER_GAS) / 1e18

    console.log(`[${i + 1}/2] nonce ${nonce} ${labels[i]}`)
    console.log(`  gas reviewed/est(sub/ver)/selected: ${metrics.reviewedGas}/${metrics.submission}/${metrics.verification}/${metrics.gas}`)
    console.log(`  max fee envelope: ${maxCost} MON`)

    const raw = buildSignedTx(t)
    const preparedHash = keccak256(raw)
    const entry = {
      index: i + 1,
      nonce: nonce.toString(),
      label: labels[i],
      to: t.to ?? null,
      reviewedGas: metrics.reviewedGas.toString(),
      estimateSubmission: metrics.submission.toString(),
      estimateVerification: metrics.verification.toString(),
      selectedGas: metrics.gas.toString(),
      gasMarginPercent: metrics.marginPercent,
      preparedHash,
      state: 'PREPARED',
      preparedAt: new Date().toISOString(),
    }
    journal.entries.push(entry)
    atomicWrite(journalPath, journal)

    let sentHash
    try {
      sentHash = await rpc('eth_sendRawTransaction', [raw])
    } catch (error) {
      entry.state = 'SEND_ERROR'
      entry.error = String(error?.message ?? error)
      atomicWrite(journalPath, journal)
      throw error
    }
    if (lower(sentHash) !== lower(preparedHash)) {
      entry.state = 'HASH_MISMATCH'
      entry.sentHash = sentHash
      atomicWrite(journalPath, journal)
      die(`tx ${i + 1}: RPC returned ${sentHash}, signed hash was ${preparedHash}`)
    }
    entry.state = 'SENT'
    entry.sentHash = sentHash
    entry.sentAt = new Date().toISOString()
    atomicWrite(journalPath, journal)
    console.log(`  sent ${sentHash}`)

    const receipt = await waitForReceipt(sentHash)
    entry.receipt = {
      status: receipt.status,
      blockNumber: receipt.blockNumber,
      contractAddress: receipt.contractAddress ?? null,
      gasUsed: receipt.gasUsed,
    }
    if (receipt.status !== '0x1') {
      entry.state = 'REVERTED'
      atomicWrite(journalPath, journal)
      die(`tx ${i + 1} reverted: ${sentHash}`)
    }

    if (i === 0 && lower(receipt.contractAddress) !== lower(ROUTER_LAB)) {
      entry.state = 'CREATE_ADDRESS_MISMATCH'
      atomicWrite(journalPath, journal)
      die(`RouterLab CREATE address ${receipt.contractAddress} != ${ROUTER_LAB}`)
    }

    console.log(`  included block ${asBigInt(receipt.blockNumber, 'receipt block')}${receipt.contractAddress ? ` contract ${receipt.contractAddress}` : ''}`)
    const finality = await waitUntilFinalAndClear(asBigInt(receipt.blockNumber, 'receipt block'))
    entry.state = 'FINALIZED'
    entry.finalizedAt = new Date().toISOString()
    entry.finalizedBlockObserved = finality.finalized.toString()
    entry.verificationFinalizedBlockObserved = finality.verifyFinalized.toString()
    entry.latestBlockObserved = finality.latest.toString()
    atomicWrite(journalPath, journal)

    await assertNonce(nonce + 1n)
    await assertPostStep(i)
    console.log(`  finalized; reserve window cleared; nonce now ${nonce + 1n}\n`)
  }

  await finalAssertions()
  journal.state = 'COMPLETE'
  journal.completedAt = new Date().toISOString()
  atomicWrite(journalPath, journal)

  console.log('ROUTER LAB BROADCAST COMPLETE: 2/2 transactions finalized.')
  console.log(`R3OSRouterLab: ${ROUTER_LAB}`)
  console.log(`final nonce: ${FINAL_NONCE}`)
  console.log(`journal: ${journalPath}`)
  console.log('STOP HERE. Mainnet deployment contracts are complete; collect and verify the full 16/16 address set next.')
}

main().catch((error) => {
  console.error(`\nROUTER LAB STOPPED: ${error?.message ?? error}`)
  console.error(`journal: ${journalPath}`)
  console.error('Do not rerun, do not use Forge --resume, and do not send another deployer transaction until this state is reviewed.')
  process.exit(1)
})
