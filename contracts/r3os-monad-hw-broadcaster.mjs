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
const LABS = '0xe6b3b17e3B1827FE02183F496e84331EBE74751C'
const CARD_MEMORY = '0x3D871B434736939748ea1BD08C06c1E8750506ec'
const MONAD_CARD = '0x0000CA12D5c07085022eBC74867157449919Fd67'
const PAGE_EXE = '0xD6182F6F25006f506A0bedC38E6a7C6B02cE15Bb'
const BLOCK_CAMERA = '0x1f3d264f0bEf5deDdbf5e92b2A5C0AA0c8c6c430'

const FIRST_NONCE = 208n
const FINAL_NONCE = 213n
const EXPECTED_GAS = [612_606n, 3_595_035n, 114_212n, 114_290n, 27_998n]
const UINT256_MAX = (1n << 256n) - 1n

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
const artifactPath = path.resolve(cwd, 'broadcast/DeployMonadHW.s.sol/143/dry-run/run-latest.json')
const journalPath = path.resolve(cwd, '../artifacts/mainnet-monad-hw-broadcast-journal.json')
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
const labsAbi = parseAbi([
  'function CORE() view returns (address)',
])
const cardMemoryAbi = parseAbi([
  'function MONAD_CARD() view returns (address)',
])
const cameraAbi = parseAbi([
  'function PAINT() view returns (address)',
  'function LABS() view returns (address)',
  'function CARD_MEMORY() view returns (address)',
  'function experimentId() view returns (uint256)',
  'function bindExperimentId(uint256 id)',
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

function expectedCalls() {
  const addPage = encodeFunctionData({
    abi: paintAbi,
    functionName: 'addExperiment',
    args: [PAGE_EXE, 'page-exe', ''],
  })
  const addCamera = encodeFunctionData({
    abi: paintAbi,
    functionName: 'addExperiment',
    args: [BLOCK_CAMERA, 'block-camera', ''],
  })
  const bindCamera = encodeFunctionData({
    abi: cameraAbi,
    functionName: 'bindExperimentId',
    args: [6n],
  })
  return [addPage, addCamera, bindCamera]
}

function validateArtifact(artifact) {
  const txEntries = artifact.transactions ?? []
  if (!Array.isArray(txEntries) || txEntries.length !== 5) die(`expected 5 Monad Hardware transactions, found ${txEntries.length}`)
  if ((artifact.receipts?.length ?? 0) !== 0) die('Monad Hardware dry-run artifact unexpectedly contains receipts')
  if ((artifact.pending?.length ?? 0) !== 0) die('Monad Hardware dry-run artifact unexpectedly contains pending entries')

  const txs = txEntries.map((entry) => entry.transaction || {})
  const expectedTargets = [null, null, PAINT, PAINT, BLOCK_CAMERA]
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

  const predictedPage = getContractAddress({ from: DEPLOYER, nonce: FIRST_NONCE })
  const predictedCamera = getContractAddress({ from: DEPLOYER, nonce: FIRST_NONCE + 1n })
  if (lower(predictedPage) !== lower(PAGE_EXE)) die(`predicted PageExe address ${predictedPage} != ${PAGE_EXE}`)
  if (lower(predictedCamera) !== lower(BLOCK_CAMERA)) die(`predicted BlockCamera address ${predictedCamera} != ${BLOCK_CAMERA}`)

  // BlockCamera constructor is exactly (Paint, Labs, CardMemory); pin all three arguments.
  const constructorTail = txData(txs[1]).slice(-192).toLowerCase()
  const expectedTail = [PAINT, LABS, CARD_MEMORY]
    .map((a) => a.slice(2).toLowerCase().padStart(64, '0'))
    .join('')
  if (constructorTail !== expectedTail) die('tx2 BlockCamera constructor args changed')

  const [expected3, expected4, expected5] = expectedCalls()
  for (const [label, actual, expected] of [
    ['tx3 addExperiment(page-exe)', txData(txs[2]), expected3],
    ['tx4 addExperiment(block-camera)', txData(txs[3]), expected4],
    ['tx5 bindExperimentId(6)', txData(txs[4]), expected5],
  ]) {
    if (lower(actual) !== lower(expected)) die(`${label} calldata changed`)
  }

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

async function assertInitialState() {
  const [chainRaw, verifyChainRaw] = await Promise.all([rpc('eth_chainId'), verifyRpc('eth_chainId')])
  const chain = asBigInt(chainRaw, 'submission chain id')
  const verifyChain = asBigInt(verifyChainRaw, 'verification chain id')
  if (chain !== 143n || verifyChain !== 143n) die(`wrong chain ${chain}/${verifyChain}`)

  await assertNonce(FIRST_NONCE)

  const codeChecks = [
    ['Paint', PAINT, true],
    ['Labs', LABS, true],
    ['CardMemory', CARD_MEMORY, true],
    ['Official Monad Card', MONAD_CARD, true],
    ['PageExe predicted address', PAGE_EXE, false],
    ['BlockCamera predicted address', BLOCK_CAMERA, false],
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

  const [paintOwner, labsCore, cardMonad, experimentCount, experimentsFrozen] = await Promise.all([
    callContract(rpcUrl, PAINT, paintAbi, 'owner'),
    callContract(rpcUrl, LABS, labsAbi, 'CORE'),
    callContract(rpcUrl, CARD_MEMORY, cardMemoryAbi, 'MONAD_CARD'),
    callContract(rpcUrl, PAINT, paintAbi, 'experimentCount'),
    callContract(rpcUrl, PAINT, paintAbi, 'experimentsFrozen'),
  ])
  if (lower(paintOwner) !== lower(DEPLOYER)) die(`Paint owner ${paintOwner} != deployer`)
  if (lower(labsCore) !== lower(PAINT)) die(`Labs.CORE ${labsCore} != Paint`)
  if (lower(cardMonad) !== lower(MONAD_CARD)) die(`CardMemory.MONAD_CARD ${cardMonad} != official Monad Card`)
  if (experimentCount !== 5n) die(`experimentCount ${experimentCount} != 5`)
  if (experimentsFrozen) die('experiment registry is frozen')

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

async function assertExperiment(id, expectedAddress, expectedName) {
  const infoRaw = await callContract(rpcUrl, PAINT, paintAbi, 'experimentInfo', [BigInt(id)])
  const info = normalizeExperimentInfo(infoRaw)
  if (
    lower(info.experiment) !== lower(expectedAddress) ||
    info.name !== expectedName ||
    info.uri !== '' ||
    info.retired !== false
  ) {
    die(`experiment ${id} mismatch: ${JSON.stringify(info, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`)
  }
}

async function assertPostStep(index) {
  if (index === 0) {
    const [subCode, verCode] = await Promise.all([
      rpc('eth_getCode', [PAGE_EXE, 'latest']),
      verifyRpc('eth_getCode', [PAGE_EXE, 'latest']),
    ])
    if (subCode === '0x' || verCode === '0x') die('PageExe CREATE finalized but code is missing')
  } else if (index === 1) {
    const [subCode, verCode, paint, labs, cardMemory, experimentId] = await Promise.all([
      rpc('eth_getCode', [BLOCK_CAMERA, 'latest']),
      verifyRpc('eth_getCode', [BLOCK_CAMERA, 'latest']),
      callContract(rpcUrl, BLOCK_CAMERA, cameraAbi, 'PAINT'),
      callContract(rpcUrl, BLOCK_CAMERA, cameraAbi, 'LABS'),
      callContract(rpcUrl, BLOCK_CAMERA, cameraAbi, 'CARD_MEMORY'),
      callContract(rpcUrl, BLOCK_CAMERA, cameraAbi, 'experimentId'),
    ])
    if (subCode === '0x' || verCode === '0x') die('BlockCamera CREATE finalized but code is missing')
    if (lower(paint) !== lower(PAINT) || lower(labs) !== lower(LABS) || lower(cardMemory) !== lower(CARD_MEMORY)) {
      die(`BlockCamera immutable links mismatch: Paint=${paint}, Labs=${labs}, CardMemory=${cardMemory}`)
    }
    if (experimentId !== UINT256_MAX) die(`BlockCamera experimentId already changed before binding: ${experimentId}`)
  } else if (index === 2) {
    const count = await callContract(rpcUrl, PAINT, paintAbi, 'experimentCount')
    if (count !== 6n) die(`after page-exe registration, experimentCount=${count}, expected 6`)
    await assertExperiment(5, PAGE_EXE, 'page-exe')
  } else if (index === 3) {
    const count = await callContract(rpcUrl, PAINT, paintAbi, 'experimentCount')
    if (count !== 7n) die(`after block-camera registration, experimentCount=${count}, expected 7`)
    await assertExperiment(6, BLOCK_CAMERA, 'block-camera')
  } else if (index === 4) {
    const experimentId = await callContract(rpcUrl, BLOCK_CAMERA, cameraAbi, 'experimentId')
    if (experimentId !== 6n) die(`BlockCamera experimentId=${experimentId}, expected 6`)
    await assertExperiment(6, BLOCK_CAMERA, 'block-camera')
  }
}

async function finalAssertions() {
  await assertNonce(FINAL_NONCE)
  const [pageCode, verifyPageCode, cameraCode, verifyCameraCode, experimentCount] = await Promise.all([
    rpc('eth_getCode', [PAGE_EXE, 'latest']),
    verifyRpc('eth_getCode', [PAGE_EXE, 'latest']),
    rpc('eth_getCode', [BLOCK_CAMERA, 'latest']),
    verifyRpc('eth_getCode', [BLOCK_CAMERA, 'latest']),
    callContract(rpcUrl, PAINT, paintAbi, 'experimentCount'),
  ])
  if (pageCode === '0x' || verifyPageCode === '0x') die('final PageExe code missing')
  if (cameraCode === '0x' || verifyCameraCode === '0x') die('final BlockCamera code missing')
  if (experimentCount !== 7n) die(`final experimentCount=${experimentCount}, expected 7`)
  for (let i = 0; i < 5; i++) await assertPostStep(i)
}

async function prepareStep(t, index) {
  const nonce = FIRST_NONCE + BigInt(index)
  await assertNonce(nonce)
  if (index === 0) {
    const [a, b] = await Promise.all([
      rpc('eth_getCode', [PAGE_EXE, 'latest']),
      verifyRpc('eth_getCode', [PAGE_EXE, 'latest']),
    ])
    if (a !== '0x' || b !== '0x') die(`PageExe predicted address ${PAGE_EXE} is not empty`)
  } else if (index === 1) {
    const [a, b] = await Promise.all([
      rpc('eth_getCode', [BLOCK_CAMERA, 'latest']),
      verifyRpc('eth_getCode', [BLOCK_CAMERA, 'latest']),
    ])
    if (a !== '0x' || b !== '0x') die(`BlockCamera predicted address ${BLOCK_CAMERA} is not empty`)
  }
  const metrics = await estimateAndSimulate(t, `Monad Hardware tx${index + 1}`)
  t.gas = metrics.gas.toString()
  await assertFeeAndBalance(metrics.gas)
  return metrics
}

async function main() {
  if (!fs.existsSync(artifactPath)) die(`missing dry-run artifact ${artifactPath}`)
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  const txs = validateArtifact(artifact)
  const live = await assertInitialState()

  // Both CREATEs can be safely estimated/simulated against the current state.
  const pageMetrics = await estimateAndSimulate(txs[0], 'Monad Hardware tx1 CREATE PageExe')
  const cameraMetrics = await estimateAndSimulate(txs[1], 'Monad Hardware tx2 CREATE BlockCamera')
  txs[0].gas = pageMetrics.gas.toString()
  txs[1].gas = cameraMetrics.gas.toString()

  console.log('\nr3OS MONAD HARDWARE BROADCAST CHECK')
  console.log(`chain:                 ${live.chain}`)
  console.log(`deployer:              ${DEPLOYER}`)
  console.log(`nonce latest/pending:  ${FIRST_NONCE}/${FIRST_NONCE}`)
  console.log(`R3OSPageExe:           ${PAGE_EXE} (empty)`)
  console.log(`R3OSBlockCamera:       ${BLOCK_CAMERA} (empty)`)
  console.log(`CardMemory:            ${CARD_MEMORY} (deployed)`)
  console.log(`transactions:          5 (nonce 208..212)`)
  console.log(`final expected nonce:  ${FINAL_NONCE}`)
  console.log(`tx1 estimate sub/ver:  ${pageMetrics.submission}/${pageMetrics.verification}`)
  console.log(`tx1 reviewed/selected: ${pageMetrics.reviewedGas}/${pageMetrics.gas}`)
  console.log(`tx2 estimate sub/ver:  ${cameraMetrics.submission}/${cameraMetrics.verification}`)
  console.log(`tx2 reviewed/selected: ${cameraMetrics.reviewedGas}/${cameraMetrics.gas}`)
  console.log(`tx5 reviewed gas:      ${EXPECTED_GAS[4]} (known unsafe vs Forge simulation; live-estimated just-in-time)`)
  console.log(`base fee sub/ver:      ${Number(live.baseFee) / 1e9}/${Number(live.verifyBaseFee) / 1e9} gwei`)
  console.log('gas margin policy:     CREATE 150% / calls 175%')
  console.log('fee cap / priority:    205 / 2 gwei')
  console.log(`mode:                  ${mode.toUpperCase()}`)

  if (mode === 'check') {
    console.log('\nREADY FOR MONAD HARDWARE SIGN-CHECK: state, artifact, CREATE addresses and both CREATE simulations passed.')
    console.log('Tx3..tx5 will be dual-provider estimated+simulated just-in-time after their prerequisites exist.')
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
    console.log(`\nMONAD HARDWARE SIGN-CHECK PASSED: tx1 nonce 208 signed locally as ${preparedHash}`)
    console.log(`selected gas: ${txs[0].gas}`)
    console.log('No transaction was submitted. Raw signed transaction was not printed or stored.')
    return
  }

  if (process.env.CONFIRM_MAINNET !== 'true') die('Monad Hardware broadcast requires CONFIRM_MAINNET=true on this exact command')
  if (process.env.CONFIRM_MONAD_HW !== 'PAGE_EXE_BLOCK_CAMERA_5_TX') {
    die('Monad Hardware broadcast requires CONFIRM_MONAD_HW=PAGE_EXE_BLOCK_CAMERA_5_TX')
  }
  if (fs.existsSync(journalPath)) die(`Monad Hardware journal already exists: ${journalPath}. Do not delete it blindly.`)

  const journal = {
    schema: 'r3os-monad-hardware-broadcast/v1',
    rpcUrlStored: false,
    deployer: DEPLOYER,
    account,
    pageExe: PAGE_EXE,
    blockCamera: BLOCK_CAMERA,
    cardMemory: CARD_MEMORY,
    maxFeePerGas: MAX_FEE_PER_GAS.toString(),
    priorityFeePerGas: PRIORITY_FEE_PER_GAS.toString(),
    gasMarginPolicy: { createPercent: Number(CREATE_GAS_MARGIN_NUM), callPercent: Number(CALL_GAS_MARGIN_NUM) },
    startedAt: new Date().toISOString(),
    entries: [],
  }
  atomicWrite(journalPath, journal)

  console.log('\nREAL MONAD HARDWARE MAINNET BROADCAST STARTING')
  console.log('Five transactions; each is dual-provider estimated+simulated, sent singly, finalized and journaled.')
  console.log('Gas policy: CREATEs use max(reviewed, 150% live estimate); calls use max(reviewed, 175% live estimate).')
  console.log('Tx5 ignores the unsafe 27,998 Forge limit and uses the live estimate plus the guarded margin.\n')

  for (let i = 0; i < txs.length; i++) {
    const t = txs[i]
    const nonce = FIRST_NONCE + BigInt(i)
    const metrics = await prepareStep(t, i)
    const maxCost = Number(metrics.gas * MAX_FEE_PER_GAS) / 1e18
    const labels = ['CREATE R3OSPageExe', 'CREATE R3OSBlockCamera', 'addExperiment(page-exe)', 'addExperiment(block-camera)', 'bindExperimentId(6)']

    console.log(`[${i + 1}/5] nonce ${nonce} ${labels[i]}`)
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

    if (i === 0 && lower(receipt.contractAddress) !== lower(PAGE_EXE)) {
      entry.state = 'CREATE_ADDRESS_MISMATCH'
      atomicWrite(journalPath, journal)
      die(`PageExe CREATE address ${receipt.contractAddress} != ${PAGE_EXE}`)
    }
    if (i === 1 && lower(receipt.contractAddress) !== lower(BLOCK_CAMERA)) {
      entry.state = 'CREATE_ADDRESS_MISMATCH'
      atomicWrite(journalPath, journal)
      die(`BlockCamera CREATE address ${receipt.contractAddress} != ${BLOCK_CAMERA}`)
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

  console.log('MONAD HARDWARE BROADCAST COMPLETE: 5/5 transactions finalized.')
  console.log(`R3OSPageExe: ${PAGE_EXE}`)
  console.log(`R3OSBlockCamera: ${BLOCK_CAMERA}`)
  console.log(`final nonce: ${FINAL_NONCE}`)
  console.log(`journal: ${journalPath}`)
  console.log('STOP HERE. Do not start Monad Kernel yet.')
}

main().catch((error) => {
  console.error(`\nMONAD HARDWARE STOPPED: ${error?.message ?? error}`)
  console.error(`journal: ${journalPath}`)
  console.error('Do not rerun, do not use Forge --resume, and do not send another deployer transaction until this state is reviewed.')
  process.exit(1)
})
