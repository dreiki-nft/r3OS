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
const MONAD_CARD = '0x0000CA12D5c07085022eBC74867157449919Fd67'
const CARD_MEMORY = '0x3D871B434736939748ea1BD08C06c1E8750506ec'

const ORIGINAL_FIRST_NONCE = 204n
const FIRST_NONCE = 206n
const FINAL_NONCE = 208n
const EXPECTED_GAS = [1_062_075n, 114_228n, 117_404n, 268_632n]

const MAX_FEE_PER_GAS = 205_000_000_000n
const PRIORITY_FEE_PER_GAS = 2_000_000_000n
const GAS_MARGIN_NUM = 130n
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
const artifactPath = path.resolve(cwd, 'broadcast/DeployMonadCard.s.sol/143/dry-run/run-latest.json')
const incidentJournalPath = path.resolve(cwd, '../artifacts/mainnet-card-drv-broadcast-journal.json')
const journalPath = path.resolve(cwd, '../artifacts/mainnet-card-drv-recovery-journal.json')
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
const passAbi = parseAbi([
  'function owner() view returns (address)',
  'function PAINT() view returns (address)',
  'function stampSourceCount() view returns (uint256)',
  'function stampSource(uint256 sourceId) view returns (address)',
  'function stampSourceEnabled(uint256 sourceId) view returns (bool)',
  'function addStampSource(address source) returns (uint256)',
])
const questsAbi = parseAbi([
  'function owner() view returns (address)',
  'function PAINT() view returns (address)',
  'function questCount() view returns (uint256)',
  'function addQuest(string name,uint48 startBlock,uint48 endBlock,(address target,bytes4 selector,uint8 word,uint8 op,uint256 threshold)[] conditions) returns (uint256)',
  'function questInfo(uint256 questId) view returns (string name,uint48 startBlock,uint48 endBlock,(address target,bytes4 selector,uint8 word,uint8 op,uint256 threshold)[] conditions)',
])
const cardMemoryAbi = parseAbi([
  'function MONAD_CARD() view returns (address)',
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
  const addExperiment = encodeFunctionData({
    abi: paintAbi,
    functionName: 'addExperiment',
    args: [CARD_MEMORY, 'card-drv', ''],
  })
  const addStampSource = encodeFunctionData({
    abi: passAbi,
    functionName: 'addStampSource',
    args: [CARD_MEMORY],
  })
  const addQuest = encodeFunctionData({
    abi: questsAbi,
    functionName: 'addQuest',
    args: [
      'CARD CARRIER',
      0,
      0,
      [
        { target: MONAD_CARD, selector: '0x70a08231', word: 0, op: 0, threshold: 1n },
        { target: PAINT, selector: '0x4d97621f', word: 2, op: 0, threshold: 143n },
      ],
    ],
  })
  return [addExperiment, addStampSource, addQuest]
}

function validateArtifact(artifact) {
  const txEntries = artifact.transactions ?? []
  if (!Array.isArray(txEntries) || txEntries.length !== 4) die(`expected 4 CARD.DRV transactions, found ${txEntries.length}`)
  if ((artifact.receipts?.length ?? 0) !== 0) die('CARD.DRV dry-run artifact unexpectedly contains receipts')
  if ((artifact.pending?.length ?? 0) !== 0) die('CARD.DRV dry-run artifact unexpectedly contains pending entries')

  const txs = txEntries.map((entry) => entry.transaction || {})
  const expectedTargets = [null, PAINT, PASS, QUESTS]
  for (let i = 0; i < txs.length; i++) {
    const t = txs[i]
    const nonce = asBigInt(t.nonce, `tx${i + 1} nonce`)
    const gas = asBigInt(t.gas, `tx${i + 1} gas`)
    if (nonce !== ORIGINAL_FIRST_NONCE + BigInt(i)) die(`tx${i + 1}: nonce ${nonce} changed`)
    if (gas !== EXPECTED_GAS[i]) die(`tx${i + 1}: reviewed gas ${gas} != ${EXPECTED_GAS[i]}`)
    if (lower(t.from) !== lower(DEPLOYER)) die(`tx${i + 1}: sender ${t.from} != deployer`)
    const expectedTo = expectedTargets[i]
    if (expectedTo == null) {
      if (t.to != null && t.to !== '') die(`tx1 must be CREATE; got to=${t.to}`)
    } else if (lower(t.to) !== lower(expectedTo)) {
      die(`tx${i + 1}: target ${t.to} != ${expectedTo}`)
    }
    if (asBigInt(t.value ?? 0, `tx${i + 1} value`) !== 0n) die(`tx${i + 1}: nonzero value`)
    txData(t)
  }

  const predicted = getContractAddress({ from: DEPLOYER, nonce: ORIGINAL_FIRST_NONCE })
  if (lower(predicted) !== lower(CARD_MEMORY)) die(`predicted CREATE address ${predicted} != ${CARD_MEMORY}`)
  const constructorTail = txData(txs[0]).slice(-64).toLowerCase()
  const expectedTail = MONAD_CARD.slice(2).toLowerCase().padStart(64, '0')
  if (constructorTail !== expectedTail) die('tx1 constructor arg is not the official Monad Card address')

  const [expected2, expected3, expected4] = expectedCalls()
  for (const [label, actual, expected] of [
    ['tx2 addExperiment(card-drv)', txData(txs[1]), expected2],
    ['tx3 addStampSource(CardMemory)', txData(txs[2]), expected3],
    ['tx4 addQuest(CARD CARRIER)', txData(txs[3]), expected4],
  ]) {
    if (lower(actual) !== lower(expected)) die(`${label} calldata changed`)
  }
  return [txs[2], txs[3]]
}

function unpack(value, names, label) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') {
    const out = names.map((name) => value[name])
    if (out.every((v) => v !== undefined)) return out
  }
  die(`${label} returned an unexpected decoded shape`)
}

function unpackCondition(value, label) {
  const [target, selector, word, op, threshold] = unpack(value, ['target', 'selector', 'word', 'op', 'threshold'], label)
  return { target, selector, word: Number(word), op: Number(op), threshold: asBigInt(threshold, `${label} threshold`) }
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

function withGasMargin(estimate, reviewedGas) {
  const padded = (estimate * GAS_MARGIN_NUM + GAS_MARGIN_DEN - 1n) / GAS_MARGIN_DEN
  const selected = padded > reviewedGas ? padded : reviewedGas
  if (selected <= estimate) die(`selected gas ${selected} does not exceed live estimate ${estimate}`)
  if (selected >= MAX_MONAD_GAS) die(`selected gas ${selected} is not below Monad 30,000,000 limit`)
  return selected
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

async function assertIncidentJournal() {
  if (!fs.existsSync(incidentJournalPath)) die(`missing CARD.DRV incident journal ${incidentJournalPath}`)
  const incident = JSON.parse(fs.readFileSync(incidentJournalPath, 'utf8'))
  if (incident.schema !== 'r3os-card-drv-broadcast/v1') die(`unexpected incident journal schema ${incident.schema}`)
  if (lower(incident.deployer) !== lower(DEPLOYER)) die('incident journal deployer mismatch')
  if (lower(incident.cardMemory) !== lower(CARD_MEMORY)) die('incident journal CardMemory mismatch')
  const entries = incident.entries ?? []
  if (!Array.isArray(entries) || entries.length !== 2) die(`incident journal must contain exactly 2 entries; found ${entries.length}`)
  const expected = [
    { index: 1, nonce: '204', hash: '0x4098039ff4fba5b49e27e63968b496415e7c36af038d25e0b6b2ec7c37b6adbe' },
    { index: 2, nonce: '205', hash: '0xb9bdc584a0d7d7ae7716687d33068cc923f179a9448ba49b3732944eba8f12f4' },
  ]
  for (let i = 0; i < 2; i++) {
    const e = entries[i]
    const x = expected[i]
    if (e.index !== x.index || String(e.nonce) !== x.nonce || e.state !== 'FINALIZED') die(`incident entry ${i + 1} is not the expected FINALIZED state`)
    if (lower(e.sentHash) !== x.hash || lower(e.preparedHash) !== x.hash) die(`incident entry ${i + 1} hash mismatch`)
    if (e.receipt?.status !== '0x1') die(`incident entry ${i + 1} receipt is not successful`)
  }
  if (lower(entries[0].receipt?.contractAddress) !== lower(CARD_MEMORY)) die('incident tx1 contract address mismatch')
  if (lower(entries[1].to) !== lower(PAINT)) die('incident tx2 target mismatch')
  return incident
}

async function readExperiment4() {
  const info = await callContract(rpcUrl, PAINT, paintAbi, 'experimentInfo', [4n])
  const [experiment, name, uri, retired] = unpack(info, ['experiment', 'name', 'uri', 'retired'], 'experimentInfo(4)')
  return { experiment, name, uri, retired }
}

async function assertInitialState() {
  await assertIncidentJournal()
  const [chainRaw, verifyChainRaw] = await Promise.all([rpc('eth_chainId'), verifyRpc('eth_chainId')])
  const chain = asBigInt(chainRaw, 'submission chain id')
  const verifyChain = asBigInt(verifyChainRaw, 'verification chain id')
  if (chain !== 143n || verifyChain !== 143n) die(`wrong chain ${chain}/${verifyChain}`)
  await assertNonce(FIRST_NONCE)

  for (const [name, address] of [['Paint', PAINT], ['PainterPass', PASS], ['Quests', QUESTS], ['Official Monad Card', MONAD_CARD], ['R3OSCardMemory', CARD_MEMORY]]) {
    const [a, b] = await Promise.all([rpc('eth_getCode', [address, 'latest']), verifyRpc('eth_getCode', [address, 'latest'])])
    if (a === '0x' || b === '0x') die(`${name} code is missing`) 
  }

  const [paintOwner, passOwner, questsOwner, painterPass, passPaint, questsPaint, card,
    experimentCount, experimentsFrozen, stampSourceCount, questCount] = await Promise.all([
    callContract(rpcUrl, PAINT, paintAbi, 'owner'),
    callContract(rpcUrl, PASS, passAbi, 'owner'),
    callContract(rpcUrl, QUESTS, questsAbi, 'owner'),
    callContract(rpcUrl, PAINT, paintAbi, 'painterPass'),
    callContract(rpcUrl, PASS, passAbi, 'PAINT'),
    callContract(rpcUrl, QUESTS, questsAbi, 'PAINT'),
    callContract(rpcUrl, CARD_MEMORY, cardMemoryAbi, 'MONAD_CARD'),
    callContract(rpcUrl, PAINT, paintAbi, 'experimentCount'),
    callContract(rpcUrl, PAINT, paintAbi, 'experimentsFrozen'),
    callContract(rpcUrl, PASS, passAbi, 'stampSourceCount'),
    callContract(rpcUrl, QUESTS, questsAbi, 'questCount'),
  ])
  for (const [name, owner] of [['Paint', paintOwner], ['Pass', passOwner], ['Quests', questsOwner]]) {
    if (lower(owner) !== lower(DEPLOYER)) die(`${name} owner ${owner} != deployer`)
  }
  if (lower(painterPass) !== lower(PASS)) die(`Paint.painterPass ${painterPass} != PainterPass`)
  if (lower(passPaint) !== lower(PAINT) || lower(questsPaint) !== lower(PAINT)) die('Pass/Quests Paint link mismatch')
  if (lower(card) !== lower(MONAD_CARD)) die(`CardMemory.MONAD_CARD ${card} != official Monad Card`)
  if (experimentCount !== 5n) die(`experimentCount ${experimentCount} != 5`)
  if (experimentsFrozen) die('experiment registry is frozen')
  if (stampSourceCount !== 2n) die(`stampSourceCount ${stampSourceCount} != 2; tx3 may already have executed`)
  if (questCount !== 7n) die(`questCount ${questCount} != 7; tx4 may already have executed`)

  const exp = await readExperiment4()
  if (lower(exp.experiment) !== lower(CARD_MEMORY) || exp.name !== 'card-drv' || exp.uri !== '' || exp.retired !== false) {
    die(`experiment 4 mismatch: ${JSON.stringify(exp)}`)
  }

  const [latestBlock, verifyBlock, balanceRaw] = await Promise.all([
    rpc('eth_getBlockByNumber', ['latest', false]),
    verifyRpc('eth_getBlockByNumber', ['latest', false]),
    rpc('eth_getBalance', [DEPLOYER, 'latest']),
  ])
  const baseFee = asBigInt(latestBlock.baseFeePerGas, 'submission base fee')
  const verifyBaseFee = asBigInt(verifyBlock.baseFeePerGas, 'verification base fee')
  const balance = asBigInt(balanceRaw, 'deployer balance')
  if (baseFee + PRIORITY_FEE_PER_GAS > MAX_FEE_PER_GAS || verifyBaseFee + PRIORITY_FEE_PER_GAS > MAX_FEE_PER_GAS) die('base fee moved above approved 205 gwei cap')
  if (balance < MIN_BALANCE) die(`deployer balance below ${MIN_BALANCE / MON} MON reserve`)
  return { chain, baseFee, verifyBaseFee, balance }
}

async function assertPostStep(index) {
  if (index === 0) {
    const [count, source, enabled] = await Promise.all([
      callContract(rpcUrl, PASS, passAbi, 'stampSourceCount'),
      callContract(rpcUrl, PASS, passAbi, 'stampSource', [2n]),
      callContract(rpcUrl, PASS, passAbi, 'stampSourceEnabled', [2n]),
    ])
    if (count !== 3n || lower(source) !== lower(CARD_MEMORY) || enabled !== true) {
      die(`stamp source 2 mismatch: count=${count}, source=${source}, enabled=${enabled}`)
    }
  } else if (index === 1) {
    const [count, info] = await Promise.all([
      callContract(rpcUrl, QUESTS, questsAbi, 'questCount'),
      callContract(rpcUrl, QUESTS, questsAbi, 'questInfo', [7n]),
    ])
    if (count !== 8n) die(`after CARD CARRIER, questCount=${count}, expected 8`)
    const [name, startBlock, endBlock, conditions] = unpack(info, ['name', 'startBlock', 'endBlock', 'conditions'], 'questInfo(7)')
    if (name !== 'CARD CARRIER' || asBigInt(startBlock, 'quest startBlock') !== 0n || asBigInt(endBlock, 'quest endBlock') !== 0n || !Array.isArray(conditions) || conditions.length !== 2) die('quest 7 header mismatch')
    const a = unpackCondition(conditions[0], 'quest condition 0')
    const b = unpackCondition(conditions[1], 'quest condition 1')
    if (
      lower(a.target) !== lower(MONAD_CARD) || lower(a.selector) !== '0x70a08231' || a.word !== 0 || a.op !== 0 || a.threshold !== 1n ||
      lower(b.target) !== lower(PAINT) || lower(b.selector) !== '0x4d97621f' || b.word !== 2 || b.op !== 0 || b.threshold !== 143n
    ) die('quest 7 conditions mismatch')
  }
}

async function finalAssertions() {
  await assertNonce(FINAL_NONCE)
  const [experimentCount, stampSourceCount, questCount] = await Promise.all([
    callContract(rpcUrl, PAINT, paintAbi, 'experimentCount'),
    callContract(rpcUrl, PASS, passAbi, 'stampSourceCount'),
    callContract(rpcUrl, QUESTS, questsAbi, 'questCount'),
  ])
  if (experimentCount !== 5n || stampSourceCount !== 3n || questCount !== 8n) {
    die(`final counts mismatch: experiments=${experimentCount}, stamps=${stampSourceCount}, quests=${questCount}`)
  }
  const exp = await readExperiment4()
  if (lower(exp.experiment) !== lower(CARD_MEMORY) || exp.name !== 'card-drv' || exp.uri !== '' || exp.retired !== false) die('final experiment 4 mismatch')
  await assertPostStep(0)
  await assertPostStep(1)
}

async function prepareStep(t, index) {
  const nonce = FIRST_NONCE + BigInt(index)
  await assertNonce(nonce)
  const metrics = await estimateAndSimulate(t, `CARD.DRV recovery tx${index + 3}`)
  t.gas = metrics.gas.toString()
  await assertFeeAndBalance(metrics.gas)
  return metrics
}

async function main() {
  if (!fs.existsSync(artifactPath)) die(`missing dry-run artifact ${artifactPath}`)
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  const txs = validateArtifact(artifact)
  const live = await assertInitialState()

  const firstMetrics = await estimateAndSimulate(txs[0], 'CARD.DRV recovery tx3 addStampSource')
  const secondMetrics = await estimateAndSimulate(txs[1], 'CARD.DRV recovery tx4 addQuest')
  txs[0].gas = firstMetrics.gas.toString()
  txs[1].gas = secondMetrics.gas.toString()

  console.log('\nr3OS CARD.DRV RECOVERY CHECK')
  console.log(`chain:                 ${live.chain}`)
  console.log(`deployer:              ${DEPLOYER}`)
  console.log(`nonce latest/pending:  ${FIRST_NONCE}/${FIRST_NONCE}`)
  console.log(`R3OSCardMemory:        ${CARD_MEMORY} (deployed)`)
  console.log(`experiment 4:          card-drv registered`)
  console.log(`remaining txs:         2 (nonce 206..207)`)
  console.log(`final expected nonce:  ${FINAL_NONCE}`)
  console.log(`tx3 estimate sub/ver:  ${firstMetrics.submission}/${firstMetrics.verification}`)
  console.log(`tx3 reviewed/selected: ${firstMetrics.reviewedGas}/${firstMetrics.gas}`)
  console.log(`tx4 estimate sub/ver:  ${secondMetrics.submission}/${secondMetrics.verification}`)
  console.log(`tx4 reviewed/selected: ${secondMetrics.reviewedGas}/${secondMetrics.gas}`)
  console.log(`base fee sub/ver:      ${Number(live.baseFee) / 1e9}/${Number(live.verifyBaseFee) / 1e9} gwei`)
  console.log('fee cap / priority:    205 / 2 gwei')
  console.log(`mode:                  ${mode.toUpperCase()}`)

  if (mode === 'check') {
    console.log('\nREADY FOR CARD.DRV RECOVERY SIGN-CHECK: incident state and both remaining simulations passed.')
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
    console.log(`\nCARD.DRV RECOVERY SIGN-CHECK PASSED: tx3 nonce 206 signed locally as ${preparedHash}`)
    console.log(`selected gas: ${txs[0].gas}`)
    console.log('No transaction was submitted. Raw signed transaction was not printed or stored.')
    return
  }

  if (process.env.CONFIRM_MAINNET !== 'true') die('CARD.DRV recovery broadcast requires CONFIRM_MAINNET=true')
  if (process.env.CONFIRM_CARD_DRV_RECOVERY !== 'RESUME_NONCE_206_2_TX') die('CARD.DRV recovery requires CONFIRM_CARD_DRV_RECOVERY=RESUME_NONCE_206_2_TX')
  if (fs.existsSync(journalPath)) die(`CARD.DRV recovery journal already exists: ${journalPath}. Do not delete it blindly.`)

  const journal = {
    schema: 'r3os-card-drv-recovery/v1',
    rpcUrlStored: false,
    deployer: DEPLOYER,
    account,
    cardMemory: CARD_MEMORY,
    incidentJournal: path.basename(incidentJournalPath),
    maxFeePerGas: MAX_FEE_PER_GAS.toString(),
    priorityFeePerGas: PRIORITY_FEE_PER_GAS.toString(),
    gasMarginPercent: Number(GAS_MARGIN_NUM),
    startedAt: new Date().toISOString(),
    entries: [],
  }
  atomicWrite(journalPath, journal)

  console.log('\nREAL CARD.DRV RECOVERY BROADCAST STARTING')
  console.log('Only original tx3 and tx4 will be sent, at nonces 206 and 207.\n')

  for (let i = 0; i < txs.length; i++) {
    const t = txs[i]
    const nonce = FIRST_NONCE + BigInt(i)
    const metrics = await prepareStep(t, i)
    const maxCost = Number(metrics.gas * MAX_FEE_PER_GAS) / 1e18
    const label = i === 0 ? 'addStampSource(CardMemory)' : 'addQuest(CARD CARRIER)'
    console.log(`[${i + 1}/2] nonce ${nonce} ${label}`)
    console.log(`  gas reviewed/est(sub/ver)/selected: ${metrics.reviewedGas}/${metrics.submission}/${metrics.verification}/${metrics.gas}`)
    console.log(`  max fee envelope: ${maxCost} MON`)

    const raw = buildSignedTx(t)
    const preparedHash = keccak256(raw)
    const entry = {
      index: i + 1,
      originalIndex: i + 3,
      nonce: nonce.toString(),
      to: t.to ?? null,
      reviewedGas: metrics.reviewedGas.toString(),
      estimateSubmission: metrics.submission.toString(),
      estimateVerification: metrics.verification.toString(),
      selectedGas: metrics.gas.toString(),
      preparedHash,
      state: 'PREPARED',
      preparedAt: new Date().toISOString(),
    }
    journal.entries.push(entry)
    atomicWrite(journalPath, journal)

    let sentHash
    try { sentHash = await rpc('eth_sendRawTransaction', [raw]) }
    catch (error) {
      entry.state = 'SEND_ERROR'; entry.error = String(error?.message ?? error); atomicWrite(journalPath, journal); throw error
    }
    if (lower(sentHash) !== lower(preparedHash)) {
      entry.state = 'HASH_MISMATCH'; entry.sentHash = sentHash; atomicWrite(journalPath, journal)
      die(`recovery tx${i + 3}: RPC hash ${sentHash} != local prepared hash ${preparedHash}`)
    }
    entry.state = 'SENT'; entry.sentHash = sentHash; entry.sentAt = new Date().toISOString(); atomicWrite(journalPath, journal)
    console.log(`  sent ${sentHash}`)

    const receipt = await waitForReceipt(sentHash)
    entry.receipt = { status: receipt.status, blockNumber: receipt.blockNumber, contractAddress: receipt.contractAddress ?? null, gasUsed: receipt.gasUsed ?? null }
    if (receipt.status !== '0x1') { entry.state = 'REVERTED'; atomicWrite(journalPath, journal); die(`CARD.DRV recovery tx${i + 3} reverted: ${sentHash}`) }
    const receiptBlock = asBigInt(receipt.blockNumber, 'receipt block')
    entry.state = 'INCLUDED'; atomicWrite(journalPath, journal)
    console.log(`  included block ${receiptBlock}`)

    const aged = await waitUntilFinalAndClear(receiptBlock)
    entry.state = 'FINALIZED'; entry.finalizedAt = new Date().toISOString(); entry.finalizedBlockObserved = aged.finalized.toString(); entry.verificationFinalizedBlockObserved = aged.verifyFinalized.toString(); entry.latestBlockObserved = aged.latest.toString(); atomicWrite(journalPath, journal)
    await assertNonce(nonce + 1n)
    await assertPostStep(i)
    console.log(`  finalized; reserve window cleared; nonce now ${nonce + 1n}\n`)
  }

  await finalAssertions()
  journal.completedAt = new Date().toISOString(); journal.state = 'COMPLETE'; journal.finalNonce = FINAL_NONCE.toString(); atomicWrite(journalPath, journal)
  console.log('CARD.DRV RECOVERY COMPLETE: 2/2 remaining transactions finalized.')
  console.log(`R3OSCardMemory: ${CARD_MEMORY}`)
  console.log(`final nonce: ${FINAL_NONCE}`)
  console.log(`journal: ${journalPath}`)
  console.log('STOP HERE. Do not start Monad Hardware yet.')
}

main().catch((error) => {
  console.error(`\nCARD.DRV RECOVERY STOPPED: ${error.message}`)
  console.error(`journal: ${journalPath}`)
  console.error('Do not rerun, do not use Forge --resume, and do not send another deployer transaction until this state is reviewed.')
  process.exit(1)
})
