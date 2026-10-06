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
const PASS = '0xb2D2D7681F451D9c69eD5eF2A0ed0B6b6494F103'
const QUESTS = '0x4398f022d7700cf5541Ac59D2Ff83f1A8a30a6f1'
const AUCTION = '0x3D3154dB1B32724a82Ac9eC3f1811808558b9EF8'
const RECYCLE_BIN = '0x02234e30daC8Bed319F30FB1Ec123da8bf71A2eb'
const CARD_MEMORY = '0x3D871B434736939748ea1BD08C06c1E8750506ec'
const MONAD_CARD = '0x0000CA12D5c07085022eBC74867157449919Fd67'
const PAGE_EXE = '0xD6182F6F25006f506A0bedC38E6a7C6B02cE15Bb'
const BLOCK_CAMERA = '0x1f3d264f0bEf5deDdbf5e92b2A5C0AA0c8c6c430'
const OPERATOR_RECORD = '0xEd7c82243C63eB1Cf51E1210f7846b4EC8725A6E'
const SYSTEM_EVENT = '0xB93A2b18437A1f169D39D81aAD19b074D6292066'
const MON_USD_FEED = '0xBcD78f76005B7515837af6b50c7C52BCf73822fb'
const TRIGGER_MILLI_USD = 333n
const FEED_MAX_AGE = 4200n
const ZERO = '0x0000000000000000000000000000000000000000'

const FIRST_NONCE = 213n
const FINAL_NONCE = 217n
const EXPECTED_GAS = [2_729_556n, 691_897n, 114_337n, 114_290n]

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
const artifactPath = path.resolve(cwd, 'broadcast/DeployOperator.s.sol/143/dry-run/run-latest.json')
const journalPath = path.resolve(cwd, '../artifacts/mainnet-operator-system-event-broadcast-journal.json')
const rpcUrl = process.env.RPC_URL || 'https://rpc.monad.xyz'
const verifyRpcUrl = process.env.VERIFY_RPC_URL || 'https://rpc.monad.xyz'
const account = process.env.R3OS_KEYSTORE_ACCOUNT || 'r3os-deployer'
const passwordFile = process.env.R3OS_KEYSTORE_PASSWORD_FILE || ''

const paintAbi = parseAbi([
  'function owner() view returns (address)',
  'function painterPass() view returns (address)',
  'function experimentCount() view returns (uint256)',
  'function experimentsFrozen() view returns (bool)',
  'function addExperiment(address experiment,string name,string uri) returns (uint256)',
  'function experimentInfo(uint256 experimentId) view returns ((address experiment,string name,string uri,bool retired))',
])
const cardMemoryAbi = parseAbi([
  'function MONAD_CARD() view returns (address)',
])
const cameraAbi = parseAbi([
  'function experimentId() view returns (uint256)',
])
const operatorAbi = parseAbi([
  'function PAINT() view returns (address)',
  'function PASS() view returns (address)',
  'function QUESTS() view returns (address)',
  'function FLIPBOOK() view returns (address)',
  'function WEEDS() view returns (address)',
  'function FORKS() view returns (address)',
  'function BRUSHES() view returns (address)',
  'function AUCTION() view returns (address)',
  'function SLEEPWALKER() view returns (address)',
  'function RECYCLE_BIN() view returns (address)',
  'function BLOCK_CAMERA() view returns (address)',
  'function KERNEL_DEBUGGER() view returns (address)',
  'function PAGE_EXE() view returns (address)',
  'function CARD_MEMORY() view returns (address)',
  'function MONAD_CARD() view returns (address)',
])
const systemEventAbi = parseAbi([
  'function FEED() view returns (address)',
  'function FEED_DECIMALS() view returns (uint8)',
  'function THRESHOLD_MILLI_USD() view returns (uint256)',
  'function THRESHOLD() view returns (int256)',
  'function MAX_AGE() view returns (uint256)',
  'function activatedBlock() view returns (uint48)',
])
const feedAbi = parseAbi([
  'function description() view returns (string)',
  'function decimals() view returns (uint8)',
  'function latestRoundData() view returns (uint80 roundId,int256 answer,uint256 startedAt,uint256 updatedAt,uint80 answeredInRound)',
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

function normalizeRoundData(info) {
  if (Array.isArray(info)) {
    return {
      roundId: info[0], answer: info[1], startedAt: info[2], updatedAt: info[3], answeredInRound: info[4],
    }
  }
  if (info && typeof info === 'object') {
    return {
      roundId: info.roundId ?? info[0],
      answer: info.answer ?? info[1],
      startedAt: info.startedAt ?? info[2],
      updatedAt: info.updatedAt ?? info[3],
      answeredInRound: info.answeredInRound ?? info[4],
    }
  }
  die(`unexpected latestRoundData decode: ${String(info)}`)
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

function expectedCalls() {
  const addRecord = encodeFunctionData({
    abi: paintAbi,
    functionName: 'addExperiment',
    args: [OPERATOR_RECORD, 'operator-record', ''],
  })
  const addSystemEvent = encodeFunctionData({
    abi: paintAbi,
    functionName: 'addExperiment',
    args: [SYSTEM_EVENT, 'system-event', ''],
  })
  return [addRecord, addSystemEvent]
}

function addressWord(address) {
  return address.slice(2).toLowerCase().padStart(64, '0')
}

function uintWord(value) {
  return BigInt(value).toString(16).padStart(64, '0')
}

function validateArtifact(artifact) {
  const txEntries = artifact.transactions ?? []
  if (!Array.isArray(txEntries) || txEntries.length !== 4) die(`expected 4 Operator/System Event transactions, found ${txEntries.length}`)
  if ((artifact.receipts?.length ?? 0) !== 0) die('Operator/System Event dry-run artifact unexpectedly contains receipts')
  if ((artifact.pending?.length ?? 0) !== 0) die('Operator/System Event dry-run artifact unexpectedly contains pending entries')

  const txs = txEntries.map((entry) => entry.transaction || {})
  const expectedTargets = [null, null, PAINT, PAINT]
  for (let i = 0; i < txs.length; i++) {
    const t = txs[i]
    const nonce = asBigInt(t.nonce, `tx${i + 1} nonce`)
    const gas = asBigInt(t.gas, `tx${i + 1} gas`)
    if (nonce !== FIRST_NONCE + BigInt(i)) die(`tx${i + 1}: nonce ${nonce} changed`)
    if (gas !== EXPECTED_GAS[i]) die(`tx${i + 1}: reviewed gas ${gas} != ${EXPECTED_GAS[i]}`)
    if (lower(t.from) !== lower(DEPLOYER)) die(`tx${i + 1}: sender ${t.from} != deployer`)
    const expectedTo = expectedTargets[i]
    if (expectedTo == null) {
      if (t.to != null && t.to !== '') die(`tx${i + 1} must be CREATE; got to=${t.to}`)
    } else if (lower(t.to) !== lower(expectedTo)) {
      die(`tx${i + 1}: target ${t.to} != ${expectedTo}`)
    }
    if (asBigInt(t.value ?? 0, `tx${i + 1} value`) !== 0n) die(`tx${i + 1}: nonzero value`)
    txData(t)
  }

  const predictedRecord = getContractAddress({ from: DEPLOYER, nonce: FIRST_NONCE })
  const predictedEvent = getContractAddress({ from: DEPLOYER, nonce: FIRST_NONCE + 1n })
  if (lower(predictedRecord) !== lower(OPERATOR_RECORD)) die(`predicted OperatorRecord address ${predictedRecord} != ${OPERATOR_RECORD}`)
  if (lower(predictedEvent) !== lower(SYSTEM_EVENT)) die(`predicted SystemEvent address ${predictedEvent} != ${SYSTEM_EVENT}`)

  const sources = [
    PAINT,
    PASS,
    QUESTS,
    ZERO,
    ZERO,
    ZERO,
    ZERO,
    AUCTION,
    ZERO,
    RECYCLE_BIN,
    BLOCK_CAMERA,
    ZERO,
    PAGE_EXE,
    CARD_MEMORY,
  ]
  const operatorTail = txData(txs[0]).slice(-(sources.length * 64)).toLowerCase()
  const expectedOperatorTail = sources.map(addressWord).join('')
  if (operatorTail !== expectedOperatorTail) die('tx1 OperatorRecord constructor Sources tuple changed')

  const eventTail = txData(txs[1]).slice(-(3 * 64)).toLowerCase()
  const expectedEventTail = `${addressWord(MON_USD_FEED)}${uintWord(TRIGGER_MILLI_USD)}${uintWord(FEED_MAX_AGE)}`
  if (eventTail !== expectedEventTail) die('tx2 SystemEvent constructor args changed')

  const [expected3, expected4] = expectedCalls()
  if (lower(txData(txs[2])) !== lower(expected3)) die('tx3 addExperiment(operator-record) calldata changed')
  if (lower(txData(txs[3])) !== lower(expected4)) die('tx4 addExperiment(system-event) calldata changed')

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
  const reviewedGas = asBigInt(t.gas, `${label} reviewed gas`)
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
      info.retired !== false
    ) {
      die(`${lane} experiment ${id} mismatch: ${JSON.stringify(info, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`)
    }
  }
}

async function assertFeedHealthy() {
  const [descriptionSub, descriptionVer, decimalsSub, decimalsVer, roundSubRaw, roundVerRaw, latestBlock, verifyBlock] = await Promise.all([
    callContract(rpcUrl, MON_USD_FEED, feedAbi, 'description'),
    callContract(verifyRpcUrl, MON_USD_FEED, feedAbi, 'description'),
    callContract(rpcUrl, MON_USD_FEED, feedAbi, 'decimals'),
    callContract(verifyRpcUrl, MON_USD_FEED, feedAbi, 'decimals'),
    callContract(rpcUrl, MON_USD_FEED, feedAbi, 'latestRoundData'),
    callContract(verifyRpcUrl, MON_USD_FEED, feedAbi, 'latestRoundData'),
    rpc('eth_getBlockByNumber', ['latest', false]),
    verifyRpc('eth_getBlockByNumber', ['latest', false]),
  ])
  if (descriptionSub !== 'MON / USD' || descriptionVer !== 'MON / USD') die(`feed description mismatch: ${descriptionSub}/${descriptionVer}`)
  if (asBigInt(decimalsSub, 'submission feed decimals') !== 8n || asBigInt(decimalsVer, 'verification feed decimals') !== 8n) {
    die(`feed decimals mismatch: ${decimalsSub}/${decimalsVer}`)
  }
  const rounds = [normalizeRoundData(roundSubRaw), normalizeRoundData(roundVerRaw)]
  const timestamps = [asBigInt(latestBlock.timestamp, 'submission latest timestamp'), asBigInt(verifyBlock.timestamp, 'verification latest timestamp')]
  for (let i = 0; i < 2; i++) {
    const r = rounds[i]
    const roundId = asBigInt(r.roundId, `feed lane ${i} roundId`)
    const answer = asBigInt(r.answer, `feed lane ${i} answer`)
    const updatedAt = asBigInt(r.updatedAt, `feed lane ${i} updatedAt`)
    const answeredInRound = asBigInt(r.answeredInRound, `feed lane ${i} answeredInRound`)
    const now = timestamps[i]
    if (roundId === 0n || answeredInRound < roundId) die(`feed lane ${i} round is incomplete`)
    if (answer <= 0n) die(`feed lane ${i} answer is non-positive: ${answer}`)
    if (updatedAt === 0n || updatedAt > now) die(`feed lane ${i} updatedAt ${updatedAt} is invalid vs block timestamp ${now}`)
    if (now - updatedAt > FEED_MAX_AGE) die(`feed lane ${i} is stale by ${now - updatedAt}s; max age is ${FEED_MAX_AGE}s`)
  }
  return {
    answer: asBigInt(rounds[0].answer, 'feed answer'),
    updatedAt: asBigInt(rounds[0].updatedAt, 'feed updatedAt'),
    roundId: asBigInt(rounds[0].roundId, 'feed roundId'),
  }
}

async function assertInitialState() {
  const [chainRaw, verifyChainRaw] = await Promise.all([rpc('eth_chainId'), verifyRpc('eth_chainId')])
  const chain = asBigInt(chainRaw, 'submission chain id')
  const verifyChain = asBigInt(verifyChainRaw, 'verification chain id')
  if (chain !== 143n || verifyChain !== 143n) die(`wrong chain ${chain}/${verifyChain}`)

  await assertNonce(FIRST_NONCE)

  const codeChecks = [
    ['Paint', PAINT, true],
    ['PainterPass', PASS, true],
    ['Quests', QUESTS, true],
    ['FinaleAuction', AUCTION, true],
    ['RecycleBin', RECYCLE_BIN, true],
    ['CardMemory', CARD_MEMORY, true],
    ['PageExe', PAGE_EXE, true],
    ['BlockCamera', BLOCK_CAMERA, true],
    ['MON/USD feed', MON_USD_FEED, true],
    ['OperatorRecord predicted address', OPERATOR_RECORD, false],
    ['SystemEvent predicted address', SYSTEM_EVENT, false],
  ]
  for (const [name, address, shouldExist] of codeChecks) {
    const [a, b] = await Promise.all([
      rpc('eth_getCode', [address, 'latest']),
      verifyRpc('eth_getCode', [address, 'latest']),
    ])
    if (shouldExist ? (a === '0x' || b === '0x') : (a !== '0x' || b !== '0x')) {
      die(`${name} code state is not the expected ${shouldExist ? 'present' : 'empty'} state`)
    }
  }

  const [ownerSub, ownerVer, passSub, passVer, countSub, countVer, frozenSub, frozenVer, cardMonad, cameraId] = await Promise.all([
    callContract(rpcUrl, PAINT, paintAbi, 'owner'),
    callContract(verifyRpcUrl, PAINT, paintAbi, 'owner'),
    callContract(rpcUrl, PAINT, paintAbi, 'painterPass'),
    callContract(verifyRpcUrl, PAINT, paintAbi, 'painterPass'),
    callContract(rpcUrl, PAINT, paintAbi, 'experimentCount'),
    callContract(verifyRpcUrl, PAINT, paintAbi, 'experimentCount'),
    callContract(rpcUrl, PAINT, paintAbi, 'experimentsFrozen'),
    callContract(verifyRpcUrl, PAINT, paintAbi, 'experimentsFrozen'),
    callContract(rpcUrl, CARD_MEMORY, cardMemoryAbi, 'MONAD_CARD'),
    callContract(rpcUrl, BLOCK_CAMERA, cameraAbi, 'experimentId'),
  ])
  if (lower(ownerSub) !== lower(DEPLOYER) || lower(ownerVer) !== lower(DEPLOYER)) die(`Paint owner mismatch: ${ownerSub}/${ownerVer}`)
  if (lower(passSub) !== lower(PASS) || lower(passVer) !== lower(PASS)) die(`Paint.painterPass mismatch: ${passSub}/${passVer}`)
  if (asBigInt(countSub, 'submission experimentCount') !== 7n || asBigInt(countVer, 'verification experimentCount') !== 7n) {
    die(`experimentCount mismatch: ${countSub}/${countVer}, expected 7`)
  }
  if (frozenSub || frozenVer) die('experiment registry is frozen')
  if (lower(cardMonad) !== lower(MONAD_CARD)) die(`CardMemory.MONAD_CARD ${cardMonad} != official Monad Card`)
  if (asBigInt(cameraId, 'BlockCamera experimentId') !== 6n) die(`BlockCamera experimentId ${cameraId} != 6`)

  await assertExperiment(0, AUCTION, 'finale auction')
  await assertExperiment(1, QUESTS, 'quests')
  await assertExperiment(2, RECYCLE_BIN, 'recycle-bin')
  await assertExperiment(4, CARD_MEMORY, 'card-drv')
  await assertExperiment(5, PAGE_EXE, 'page-exe')
  await assertExperiment(6, BLOCK_CAMERA, 'block-camera')
  const feed = await assertFeedHealthy()

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

  return { chain, baseFee, verifyBaseFee, balance, feed }
}

async function assertOperatorLinks() {
  const names = [
    'PAINT', 'PASS', 'QUESTS', 'FLIPBOOK', 'WEEDS', 'FORKS', 'BRUSHES', 'AUCTION', 'SLEEPWALKER',
    'RECYCLE_BIN', 'BLOCK_CAMERA', 'KERNEL_DEBUGGER', 'PAGE_EXE', 'CARD_MEMORY', 'MONAD_CARD',
  ]
  const expected = [
    PAINT, PASS, QUESTS, ZERO, ZERO, ZERO, ZERO, AUCTION, ZERO,
    RECYCLE_BIN, BLOCK_CAMERA, ZERO, PAGE_EXE, CARD_MEMORY, MONAD_CARD,
  ]
  for (let i = 0; i < names.length; i++) {
    const [sub, ver] = await Promise.all([
      callContract(rpcUrl, OPERATOR_RECORD, operatorAbi, names[i]),
      callContract(verifyRpcUrl, OPERATOR_RECORD, operatorAbi, names[i]),
    ])
    if (lower(sub) !== lower(expected[i]) || lower(ver) !== lower(expected[i])) {
      die(`OperatorRecord.${names[i]} mismatch: ${sub}/${ver}, expected ${expected[i]}`)
    }
  }
}

async function assertSystemEventConfig() {
  const getterNames = ['FEED', 'FEED_DECIMALS', 'THRESHOLD_MILLI_USD', 'THRESHOLD', 'MAX_AGE', 'activatedBlock']
  const values = {}
  for (const name of getterNames) {
    const [sub, ver] = await Promise.all([
      callContract(rpcUrl, SYSTEM_EVENT, systemEventAbi, name),
      callContract(verifyRpcUrl, SYSTEM_EVENT, systemEventAbi, name),
    ])
    values[name] = sub
    if (name === 'FEED') {
      if (lower(sub) !== lower(MON_USD_FEED) || lower(ver) !== lower(MON_USD_FEED)) die(`SystemEvent.FEED mismatch: ${sub}/${ver}`)
    } else if (asBigInt(sub, `SystemEvent.${name}`) !== asBigInt(ver, `verification SystemEvent.${name}`)) {
      die(`SystemEvent.${name} differs across providers: ${sub}/${ver}`)
    }
  }
  if (asBigInt(values.FEED_DECIMALS, 'SystemEvent.FEED_DECIMALS') !== 8n) die(`SystemEvent.FEED_DECIMALS=${values.FEED_DECIMALS}, expected 8`)
  if (asBigInt(values.THRESHOLD_MILLI_USD, 'SystemEvent.THRESHOLD_MILLI_USD') !== TRIGGER_MILLI_USD) {
    die(`SystemEvent.THRESHOLD_MILLI_USD=${values.THRESHOLD_MILLI_USD}, expected ${TRIGGER_MILLI_USD}`)
  }
  const expectedThreshold = TRIGGER_MILLI_USD * 10n ** 8n / 1000n
  if (asBigInt(values.THRESHOLD, 'SystemEvent.THRESHOLD') !== expectedThreshold) die(`SystemEvent.THRESHOLD=${values.THRESHOLD}, expected ${expectedThreshold}`)
  if (asBigInt(values.MAX_AGE, 'SystemEvent.MAX_AGE') !== FEED_MAX_AGE) die(`SystemEvent.MAX_AGE=${values.MAX_AGE}, expected ${FEED_MAX_AGE}`)
  if (asBigInt(values.activatedBlock, 'SystemEvent.activatedBlock') !== 0n) die(`SystemEvent unexpectedly activated during deployment: block ${values.activatedBlock}`)
}

async function assertPostStep(index) {
  if (index === 0) {
    const [subCode, verCode] = await Promise.all([
      rpc('eth_getCode', [OPERATOR_RECORD, 'latest']),
      verifyRpc('eth_getCode', [OPERATOR_RECORD, 'latest']),
    ])
    if (subCode === '0x' || verCode === '0x') die('OperatorRecord CREATE finalized but code is missing')
    await assertOperatorLinks()
  } else if (index === 1) {
    const [subCode, verCode] = await Promise.all([
      rpc('eth_getCode', [SYSTEM_EVENT, 'latest']),
      verifyRpc('eth_getCode', [SYSTEM_EVENT, 'latest']),
    ])
    if (subCode === '0x' || verCode === '0x') die('SystemEvent CREATE finalized but code is missing')
    await assertSystemEventConfig()
  } else if (index === 2) {
    const [subCount, verCount] = await Promise.all([
      callContract(rpcUrl, PAINT, paintAbi, 'experimentCount'),
      callContract(verifyRpcUrl, PAINT, paintAbi, 'experimentCount'),
    ])
    if (asBigInt(subCount, 'submission experimentCount') !== 8n || asBigInt(verCount, 'verification experimentCount') !== 8n) {
      die(`after operator-record registration, experimentCount=${subCount}/${verCount}, expected 8`)
    }
    await assertExperiment(7, OPERATOR_RECORD, 'operator-record')
  } else if (index === 3) {
    const [subCount, verCount] = await Promise.all([
      callContract(rpcUrl, PAINT, paintAbi, 'experimentCount'),
      callContract(verifyRpcUrl, PAINT, paintAbi, 'experimentCount'),
    ])
    if (asBigInt(subCount, 'submission experimentCount') !== 9n || asBigInt(verCount, 'verification experimentCount') !== 9n) {
      die(`after system-event registration, experimentCount=${subCount}/${verCount}, expected 9`)
    }
    await assertExperiment(8, SYSTEM_EVENT, 'system-event')
  }
}

async function finalAssertions() {
  await assertNonce(FINAL_NONCE)
  const [recordCode, verifyRecordCode, eventCode, verifyEventCode, subCount, verCount] = await Promise.all([
    rpc('eth_getCode', [OPERATOR_RECORD, 'latest']),
    verifyRpc('eth_getCode', [OPERATOR_RECORD, 'latest']),
    rpc('eth_getCode', [SYSTEM_EVENT, 'latest']),
    verifyRpc('eth_getCode', [SYSTEM_EVENT, 'latest']),
    callContract(rpcUrl, PAINT, paintAbi, 'experimentCount'),
    callContract(verifyRpcUrl, PAINT, paintAbi, 'experimentCount'),
  ])
  if (recordCode === '0x' || verifyRecordCode === '0x') die('final OperatorRecord code missing')
  if (eventCode === '0x' || verifyEventCode === '0x') die('final SystemEvent code missing')
  if (asBigInt(subCount, 'submission final experimentCount') !== 9n || asBigInt(verCount, 'verification final experimentCount') !== 9n) {
    die(`final experimentCount=${subCount}/${verCount}, expected 9`)
  }
  await assertOperatorLinks()
  await assertSystemEventConfig()
  await assertExperiment(7, OPERATOR_RECORD, 'operator-record')
  await assertExperiment(8, SYSTEM_EVENT, 'system-event')
}

async function prepareStep(t, index) {
  const nonce = FIRST_NONCE + BigInt(index)
  await assertNonce(nonce)
  if (index === 0) {
    const [a, b] = await Promise.all([
      rpc('eth_getCode', [OPERATOR_RECORD, 'latest']),
      verifyRpc('eth_getCode', [OPERATOR_RECORD, 'latest']),
    ])
    if (a !== '0x' || b !== '0x') die(`OperatorRecord predicted address ${OPERATOR_RECORD} is not empty`)
  } else if (index === 1) {
    const [a, b] = await Promise.all([
      rpc('eth_getCode', [SYSTEM_EVENT, 'latest']),
      verifyRpc('eth_getCode', [SYSTEM_EVENT, 'latest']),
    ])
    if (a !== '0x' || b !== '0x') die(`SystemEvent predicted address ${SYSTEM_EVENT} is not empty`)
  }
  if (index === 2) {
    await assertOperatorLinks()
    const count = await callContract(rpcUrl, PAINT, paintAbi, 'experimentCount')
    if (asBigInt(count, 'experimentCount before tx3') !== 7n) die(`before tx3 experimentCount=${count}, expected 7`)
  }
  if (index === 3) {
    await assertSystemEventConfig()
    await assertExperiment(7, OPERATOR_RECORD, 'operator-record')
    const count = await callContract(rpcUrl, PAINT, paintAbi, 'experimentCount')
    if (asBigInt(count, 'experimentCount before tx4') !== 8n) die(`before tx4 experimentCount=${count}, expected 8`)
  }
  const metrics = await estimateAndSimulate(t, `Operator/System Event tx${index + 1}`)
  t.gas = metrics.gas.toString()
  await assertFeeAndBalance(metrics.gas)
  return metrics
}

async function main() {
  if (!fs.existsSync(artifactPath)) die(`missing dry-run artifact ${artifactPath}`)
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  const txs = validateArtifact(artifact)
  const live = await assertInitialState()

  // Both CREATEs are independent of each other and can be safely estimated/simulated pre-broadcast.
  const recordMetrics = await estimateAndSimulate(txs[0], 'Operator/System Event tx1 CREATE OperatorRecord')
  const eventMetrics = await estimateAndSimulate(txs[1], 'Operator/System Event tx2 CREATE SystemEvent')
  txs[0].gas = recordMetrics.gas.toString()
  txs[1].gas = eventMetrics.gas.toString()

  console.log('\nr3OS OPERATOR / SYSTEM EVENT BROADCAST CHECK')
  console.log(`chain:                 ${live.chain}`)
  console.log(`deployer:              ${DEPLOYER}`)
  console.log(`nonce latest/pending:  ${FIRST_NONCE}/${FIRST_NONCE}`)
  console.log(`R3OSOperatorRecord:    ${OPERATOR_RECORD} (empty)`)
  console.log(`R3OSSystemEvent:       ${SYSTEM_EVENT} (empty)`)
  console.log(`MON/USD feed:          ${MON_USD_FEED}`)
  console.log(`feed answer:           ${live.feed.answer}`)
  console.log(`feed updatedAt:        ${live.feed.updatedAt}`)
  console.log(`trigger/max age:       ${TRIGGER_MILLI_USD} milliUSD / ${FEED_MAX_AGE}s`)
  console.log('transactions:          4 (nonce 213..216)')
  console.log(`final expected nonce:  ${FINAL_NONCE}`)
  console.log(`tx1 estimate sub/ver:  ${recordMetrics.submission}/${recordMetrics.verification}`)
  console.log(`tx1 reviewed/selected: ${recordMetrics.reviewedGas}/${recordMetrics.gas}`)
  console.log(`tx2 estimate sub/ver:  ${eventMetrics.submission}/${eventMetrics.verification}`)
  console.log(`tx2 reviewed/selected: ${eventMetrics.reviewedGas}/${eventMetrics.gas}`)
  console.log(`base fee sub/ver:      ${Number(live.baseFee) / 1e9}/${Number(live.verifyBaseFee) / 1e9} gwei`)
  console.log('gas margin policy:     CREATE 150% / calls 175%')
  console.log('fee cap / priority:    205 / 2 gwei')
  console.log(`mode:                  ${mode.toUpperCase()}`)

  if (mode === 'check') {
    console.log('\nREADY FOR OPERATOR/SYSTEM EVENT SIGN-CHECK: state, artifact, source tuple, feed config, CREATE addresses and both CREATE simulations passed.')
    console.log('Tx3..tx4 will be dual-provider estimated+simulated just-in-time after their prerequisite contracts exist.')
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
    console.log(`\nOPERATOR/SYSTEM EVENT SIGN-CHECK PASSED: tx1 nonce ${FIRST_NONCE} signed locally as ${preparedHash}`)
    console.log(`selected gas: ${txs[0].gas}`)
    console.log('No transaction was submitted. Raw signed transaction was not printed or stored.')
    return
  }

  if (process.env.CONFIRM_MAINNET !== 'true') die('Operator/System Event broadcast requires CONFIRM_MAINNET=true on this exact command')
  if (process.env.CONFIRM_OPERATOR_SYSTEM_EVENT !== 'OPERATOR_SYSTEM_EVENT_4_TX') {
    die('Operator/System Event broadcast requires CONFIRM_OPERATOR_SYSTEM_EVENT=OPERATOR_SYSTEM_EVENT_4_TX')
  }
  if (fs.existsSync(journalPath)) die(`Operator/System Event journal already exists: ${journalPath}. Do not delete it blindly.`)

  const journal = {
    schema: 'r3os-operator-system-event-broadcast/v1',
    rpcUrlStored: false,
    deployer: DEPLOYER,
    account,
    operatorRecord: OPERATOR_RECORD,
    systemEvent: SYSTEM_EVENT,
    monUsdFeed: MON_USD_FEED,
    triggerMilliUsd: TRIGGER_MILLI_USD.toString(),
    feedMaxAge: FEED_MAX_AGE.toString(),
    maxFeePerGas: MAX_FEE_PER_GAS.toString(),
    priorityFeePerGas: PRIORITY_FEE_PER_GAS.toString(),
    gasMarginPolicy: { createPercent: Number(CREATE_GAS_MARGIN_NUM), callPercent: Number(CALL_GAS_MARGIN_NUM) },
    startedAt: new Date().toISOString(),
    entries: [],
  }
  atomicWrite(journalPath, journal)

  console.log('\nREAL OPERATOR / SYSTEM EVENT MAINNET BROADCAST STARTING')
  console.log('Four transactions; each is dual-provider estimated+simulated, sent singly, finalized and journaled.')
  console.log('Gas policy: CREATEs use max(reviewed, 150% live estimate); calls use max(reviewed, 175% live estimate).\n')

  const labels = [
    'CREATE R3OSOperatorRecord',
    'CREATE R3OSSystemEvent',
    'addExperiment(operator-record)',
    'addExperiment(system-event)',
  ]

  for (let i = 0; i < txs.length; i++) {
    const t = txs[i]
    const nonce = FIRST_NONCE + BigInt(i)
    const metrics = await prepareStep(t, i)
    const maxCost = Number(metrics.gas * MAX_FEE_PER_GAS) / 1e18

    console.log(`[${i + 1}/4] nonce ${nonce} ${labels[i]}`)
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

    if (i === 0 && lower(receipt.contractAddress) !== lower(OPERATOR_RECORD)) {
      entry.state = 'CREATE_ADDRESS_MISMATCH'
      atomicWrite(journalPath, journal)
      die(`OperatorRecord CREATE address ${receipt.contractAddress} != ${OPERATOR_RECORD}`)
    }
    if (i === 1 && lower(receipt.contractAddress) !== lower(SYSTEM_EVENT)) {
      entry.state = 'CREATE_ADDRESS_MISMATCH'
      atomicWrite(journalPath, journal)
      die(`SystemEvent CREATE address ${receipt.contractAddress} != ${SYSTEM_EVENT}`)
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

  console.log('OPERATOR / SYSTEM EVENT BROADCAST COMPLETE: 4/4 transactions finalized.')
  console.log(`R3OSOperatorRecord: ${OPERATOR_RECORD}`)
  console.log(`R3OSSystemEvent: ${SYSTEM_EVENT}`)
  console.log(`final nonce: ${FINAL_NONCE}`)
  console.log(`journal: ${journalPath}`)
  console.log('STOP HERE. Do not start Router Lab yet.')
}

main().catch((error) => {
  console.error(`\nOPERATOR / SYSTEM EVENT STOPPED: ${error?.message ?? error}`)
  console.error(`journal: ${journalPath}`)
  console.error('Do not rerun, do not use Forge --resume, and do not send another deployer transaction until this state is reviewed.')
  process.exit(1)
})
