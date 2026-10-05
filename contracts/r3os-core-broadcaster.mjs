#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { keccak256, serializeTransaction } from 'viem'

const EXPECTED_DEPLOYER = '0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA'
const EXPECTED_PAINT = '0x5102DE3817aE16b3afaEb9D180130669A70787b3'
const EXPECTED_MANIFEST = '0x307580c4fc98f28cee605a5a5bd348f08a9f1eba71788bd26eaced86e0cf67f1'
const EXPECTED_TX_COUNT = 29
const EXPECTED_FIRST_NONCE = 175n
const EXPECTED_TOTAL_GAS = 54_467_082n
const EXPECTED_MAX_TX_GAS = 23_661_866n

// Same fee ceiling already reviewed for the failed Forge broadcast attempt.
const MAX_FEE_PER_GAS = 205_000_000_000n // 205 gwei
const PRIORITY_FEE_PER_GAS = 2_000_000_000n // 2 gwei
const MON = 10n ** 18n
const RESERVE_BUDGET = 10n * MON

const mode = process.argv.includes('--broadcast') ? 'broadcast' : process.argv.includes('--sign-check') ? 'sign-check' : 'check'
const cwd = process.cwd()
const artifactPath = path.resolve(cwd, 'broadcast/Deploy.s.sol/143/run-latest.json')
const journalPath = path.resolve(cwd, '../artifacts/mainnet-core-broadcast-journal.json')
const rpcUrl = process.env.RPC_URL || 'https://rpc.monad.xyz'
const verifyRpcUrl = process.env.VERIFY_RPC_URL || 'https://rpc.monad.xyz'
const account = process.env.R3OS_KEYSTORE_ACCOUNT || 'r3os-deployer'
const passwordFile = process.env.R3OS_KEYSTORE_PASSWORD_FILE || ''

function die(message) {
  console.error(`\nABORT: ${message}`)
  process.exit(1)
}

function asBigInt(v, label) {
  if (v == null) die(`${label} is missing`)
  try { return BigInt(v) } catch { die(`${label} is not an integer: ${v}`) }
}

function hex(n) {
  return `0x${BigInt(n).toString(16)}`
}

function dec(v) {
  return asBigInt(v, 'numeric field').toString()
}

function lower(v) {
  return String(v || '').toLowerCase()
}

function runCast(args, { capture = true } = {}) {
  const castEnv = { ...process.env }
  delete castEnv.ETH_PASSWORD
  const result = spawnSync('cast', args, {
    env: castEnv,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
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

async function rpcAt(url, method, params = []) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = await res.json()
  if (body.error) {
    const err = new Error(`${method}: ${body.error.code} ${body.error.message}`)
    err.rpcError = body.error
    throw err
  }
  return body.result
}


function rpc(method, params = []) {
  return rpcAt(rpcUrl, method, params)
}

function verifyRpc(method, params = []) {
  return rpcAt(verifyRpcUrl, method, params)
}

function atomicWrite(file, value) {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
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

    if (
      latest >= target &&
      finalizedNumber >= blockNumber &&
      verifyFinalizedNumber >= blockNumber
    ) {
      return { latest, finalized: finalizedNumber, verifyFinalized: verifyFinalizedNumber }
    }
    await sleep(400)
  }

  die(`timed out waiting for tx block ${blockNumber} to finalize on both providers and age past Monad k=3 window`)
}

function buildSignedTx(t) {
  const gas = asBigInt(t.gas, 'gas')
  const nonce = asBigInt(t.nonce, 'nonce')
  const value = asBigInt(t.value ?? '0x0', 'value')
  const data = t.input ?? t.data

  if (!data || !String(data).startsWith('0x')) die(`tx nonce ${nonce}: calldata/initcode missing`)
  if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) die(`tx nonce ${nonce}: nonce exceeds safe integer range`)

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
    die(`tx nonce ${nonce}: cast wallet sign did not return a 65-byte signature`)
  }

  const body = signature.slice(2)
  const r = `0x${body.slice(0, 64)}`
  const s = `0x${body.slice(64, 128)}`
  const v = Number.parseInt(body.slice(128, 130), 16)
  const yParity = v === 27 || v === 0 ? 0 : v === 28 || v === 1 ? 1 : null
  if (yParity == null) die(`tx nonce ${nonce}: unexpected signature recovery byte ${v}`)

  const raw = serializeTransaction(tx, { r, s, yParity })
  if (!/^0x[0-9a-fA-F]+$/.test(raw)) die(`tx nonce ${nonce}: viem did not return a raw signed transaction`)
  return raw
}

function validateArtifact(j) {
  if (!Array.isArray(j.transactions)) die('broadcast artifact has no transactions array')
  if (j.transactions.length !== EXPECTED_TX_COUNT) {
    die(`expected ${EXPECTED_TX_COUNT} transactions, found ${j.transactions.length}`)
  }
  if ((j.receipts?.length ?? 0) !== 0) die('Foundry artifact already contains receipts')
  if ((j.pending?.length ?? 0) !== 0) die('Foundry artifact already contains pending transactions')

  let totalGas = 0n
  let maxGas = 0n
  const gases = []

  j.transactions.forEach((entry, i) => {
    const t = entry.transaction || {}
    const nonce = asBigInt(t.nonce, `tx ${i + 1} nonce`)
    const gas = asBigInt(t.gas, `tx ${i + 1} gas`)
    const expectedNonce = EXPECTED_FIRST_NONCE + BigInt(i)

    if (nonce !== expectedNonce) die(`tx ${i + 1}: nonce ${nonce} != expected ${expectedNonce}`)
    if (lower(t.from) !== lower(EXPECTED_DEPLOYER)) {
      die(`tx ${i + 1}: from ${t.from} != expected deployer ${EXPECTED_DEPLOYER}`)
    }
    if (gas <= 0n || gas >= 30_000_000n) die(`tx ${i + 1}: invalid Monad gas limit ${gas}`)

    totalGas += gas
    if (gas > maxGas) maxGas = gas
    gases.push(gas)
  })

  if (totalGas !== EXPECTED_TOTAL_GAS) die(`total gas ${totalGas} != reviewed ${EXPECTED_TOTAL_GAS}`)
  if (maxGas !== EXPECTED_MAX_TX_GAS) die(`max tx gas ${maxGas} != reviewed ${EXPECTED_MAX_TX_GAS}`)

  let maxThreeGas = 0n
  for (let i = 0; i < gases.length; i++) {
    const sum = gases.slice(Math.max(0, i - 2), i + 1).reduce((a, b) => a + b, 0n)
    if (sum > maxThreeGas) maxThreeGas = sum
  }
  const maxThreeEnvelope = maxThreeGas * MAX_FEE_PER_GAS
  if (maxThreeEnvelope >= RESERVE_BUDGET) {
    die(`3-tx reserve envelope ${maxThreeEnvelope} wei exceeds/equals 10 MON`)
  }

  return { totalGas, maxGas, maxThreeGas, maxThreeEnvelope }
}

async function preflight(j) {
  const [chainId, verifyChainId] = await Promise.all([
    rpc('eth_chainId').then(v => asBigInt(v, 'submission chain id')),
    verifyRpc('eth_chainId').then(v => asBigInt(v, 'verification chain id')),
  ])
  if (chainId !== 143n || verifyChainId !== 143n) {
    die(`chain mismatch: submission=${chainId}, verification=${verifyChainId}; expected 143`)
  }

  const [latestNonce, pendingNonce, verifyLatestNonce] = await Promise.all([
    rpc('eth_getTransactionCount', [EXPECTED_DEPLOYER, 'latest']).then(v => asBigInt(v, 'latest nonce')),
    rpc('eth_getTransactionCount', [EXPECTED_DEPLOYER, 'pending']).then(v => asBigInt(v, 'pending nonce')),
    verifyRpc('eth_getTransactionCount', [EXPECTED_DEPLOYER, 'latest']).then(v => asBigInt(v, 'verification latest nonce')),
  ])
  if (
    latestNonce !== EXPECTED_FIRST_NONCE ||
    pendingNonce !== EXPECTED_FIRST_NONCE ||
    verifyLatestNonce !== EXPECTED_FIRST_NONCE
  ) {
    die(`expected clean nonce 175; submission latest=${latestNonce}, pending=${pendingNonce}, verification latest=${verifyLatestNonce}`)
  }

  const [paintCode, verifyPaintCode] = await Promise.all([
    rpc('eth_getCode', [EXPECTED_PAINT, 'latest']),
    verifyRpc('eth_getCode', [EXPECTED_PAINT, 'latest']),
  ])
  if (paintCode !== '0x' || verifyPaintCode !== '0x') {
    die(`predicted Paint address already has code on at least one provider: ${EXPECTED_PAINT}`)
  }

  const balance = asBigInt(await rpc('eth_getBalance', [EXPECTED_DEPLOYER, 'latest']), 'balance')
  if (balance < 20n * MON) die(`deployer balance unexpectedly low: ${balance} wei`)

  const latestBlock = await rpc('eth_getBlockByNumber', ['latest', false])
  const baseFee = asBigInt(latestBlock.baseFeePerGas, 'base fee')
  if (baseFee + PRIORITY_FEE_PER_GAS > MAX_FEE_PER_GAS) {
    die(`base ${baseFee} + priority ${PRIORITY_FEE_PER_GAS} exceeds 205 gwei cap`)
  }

  return { chainId, verifyChainId, latestNonce, pendingNonce, verifyLatestNonce, balance, baseFee }
}

async function main() {
  if (!fs.existsSync(artifactPath)) die(`missing ${artifactPath}`)
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
  const metrics = validateArtifact(artifact)
  const live = await preflight(artifact)

  console.log('\nr3OS CORE BROADCAST CHECK')
  console.log(`manifest:           ${EXPECTED_MANIFEST}`)
  console.log(`chain:              ${live.chainId}`)
  console.log(`deployer:           ${EXPECTED_DEPLOYER}`)
  console.log(`RPC lanes:          FastLane/submission + independent verification`)
  console.log(`nonce latest/pending: ${live.latestNonce}/${live.pendingNonce}`)
  console.log(`transactions:       ${EXPECTED_TX_COUNT}`)
  console.log(`total gas limits:   ${metrics.totalGas}`)
  console.log(`max tx gas:         ${metrics.maxGas}`)
  console.log(`max 3-tx envelope:  ${Number(metrics.maxThreeEnvelope) / 1e18} MON @ 205 gwei`)
  console.log(`base fee:           ${Number(live.baseFee) / 1e9} gwei`)
  console.log(`fee cap / priority: 205 / 2 gwei`)
  console.log(`Paint code:         empty`)
  console.log(`mode:               ${mode.toUpperCase()}`)

  if (mode === 'check') {
    console.log('\nREADY: check-only passed. No transaction was signed or sent.')
    return
  }

  if (!passwordFile) {
    die('R3OS_KEYSTORE_PASSWORD_FILE is not set')
  }
  if (!fs.existsSync(passwordFile)) {
    die(`keystore password file does not exist: ${passwordFile}`)
  }

  // Verify the keystore alias resolves to the reviewed deployer before signing anything.
  const signer = runCast(['wallet', 'address', '--account', account, '--password-file', passwordFile]).split(/\s+/).at(-1)
  if (lower(signer) !== lower(EXPECTED_DEPLOYER)) {
    die(`keystore ${account} resolves to ${signer}, expected ${EXPECTED_DEPLOYER}`)
  }

  if (mode === 'sign-check') {
    const raw = buildSignedTx(artifact.transactions[0].transaction)
    const preparedHash = keccak256(raw)
    console.log(`\nSIGN-CHECK PASSED: tx #1 signed locally as ${preparedHash}`)
    console.log('No transaction was submitted. Raw signed transaction was not printed or stored.')
    return
  }

  if (process.env.CONFIRM_MAINNET !== 'true') {
    die('broadcast mode requires CONFIRM_MAINNET=true on this exact command')
  }
  if (fs.existsSync(journalPath)) {
    die(`journal already exists: ${journalPath}. Do not delete it blindly; inspect before any retry.`)
  }

  const journal = {
    schema: 'r3os-core-manual-broadcast/v1',
    manifestHash: EXPECTED_MANIFEST,
    rpcUrlStored: false,
    deployer: EXPECTED_DEPLOYER,
    account,
    maxFeePerGas: MAX_FEE_PER_GAS.toString(),
    priorityFeePerGas: PRIORITY_FEE_PER_GAS.toString(),
    startedAt: new Date().toISOString(),
    entries: [],
  }
  atomicWrite(journalPath, journal)

  console.log('\nREAL MAINNET BROADCAST STARTING')
  console.log('One transaction at a time; each must succeed, finalize, and age past the k=3 reserve window.\n')

  for (let i = 0; i < artifact.transactions.length; i++) {
    const t = artifact.transactions[i].transaction
    const expectedNonce = EXPECTED_FIRST_NONCE + BigInt(i)

    const latestNonce = asBigInt(await rpc('eth_getTransactionCount', [EXPECTED_DEPLOYER, 'latest']), 'latest nonce')
    const pendingNonce = asBigInt(await rpc('eth_getTransactionCount', [EXPECTED_DEPLOYER, 'pending']), 'pending nonce')
    if (latestNonce !== expectedNonce || pendingNonce !== expectedNonce) {
      die(`before tx ${i + 1}, nonce drift: expected ${expectedNonce}, latest=${latestNonce}, pending=${pendingNonce}`)
    }

    const latestBlock = await rpc('eth_getBlockByNumber', ['latest', false])
    const baseFee = asBigInt(latestBlock.baseFeePerGas, 'base fee')
    if (baseFee + PRIORITY_FEE_PER_GAS > MAX_FEE_PER_GAS) {
      die(`before tx ${i + 1}, base fee moved above approved 205 gwei cap`)
    }

    console.log(`[${i + 1}/${EXPECTED_TX_COUNT}] nonce ${expectedNonce} gas ${dec(t.gas)} ${t.to ? `to ${t.to}` : 'CREATE'}`)

    const raw = buildSignedTx(t)
    const preparedHash = keccak256(raw)

    const entry = {
      index: i + 1,
      nonce: expectedNonce.toString(),
      gas: dec(t.gas),
      to: t.to ?? null,
      preparedHash,
      state: 'PREPARED',
      preparedAt: new Date().toISOString(),
    }
    journal.entries.push(entry)
    atomicWrite(journalPath, journal)

    let sentHash
    try {
      sentHash = await rpc('eth_sendRawTransaction', [raw])
    } catch (err) {
      entry.state = 'SEND_ERROR'
      entry.error = err.message
      atomicWrite(journalPath, journal)
      throw err
    }

    if (lower(sentHash) !== lower(preparedHash)) {
      die(`tx ${i + 1}: RPC hash ${sentHash} != locally prepared hash ${preparedHash}`)
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
      gasUsed: receipt.gasUsed ?? null,
    }

    if (receipt.status !== '0x1') {
      entry.state = 'REVERTED'
      atomicWrite(journalPath, journal)
      die(`tx ${i + 1} reverted: ${sentHash}`)
    }

    const receiptBlock = asBigInt(receipt.blockNumber, 'receipt block')
    entry.state = 'INCLUDED'
    atomicWrite(journalPath, journal)

    console.log(`  included block ${receiptBlock}${receipt.contractAddress ? ` contract ${receipt.contractAddress}` : ''}`)

    const aged = await waitUntilFinalAndClear(receiptBlock)
    entry.state = 'FINALIZED'
    entry.finalizedAt = new Date().toISOString()
    entry.finalizedBlockObserved = aged.finalized.toString()
    entry.verificationFinalizedBlockObserved = aged.verifyFinalized.toString()
    entry.latestBlockObserved = aged.latest.toString()
    atomicWrite(journalPath, journal)

    const nonceAfter = asBigInt(await rpc('eth_getTransactionCount', [EXPECTED_DEPLOYER, 'latest']), 'nonce after')
    if (nonceAfter !== expectedNonce + 1n) {
      die(`after tx ${i + 1}, nonce ${nonceAfter} != expected ${expectedNonce + 1n}`)
    }

    console.log(`  finalized; reserve window cleared; nonce now ${nonceAfter}\n`)
  }

  const [code, verifyCode] = await Promise.all([
    rpc('eth_getCode', [EXPECTED_PAINT, 'finalized']),
    verifyRpc('eth_getCode', [EXPECTED_PAINT, 'finalized']),
  ])
  if (!code || code === '0x' || !verifyCode || verifyCode === '0x') {
    die('all txs sent but finalized Paint code is missing on at least one provider')
  }

  journal.completedAt = new Date().toISOString()
  journal.state = 'COMPLETE'
  atomicWrite(journalPath, journal)

  console.log('CORE BROADCAST COMPLETE: 29/29 transactions finalized.')
  console.log(`journal: ${journalPath}`)
  console.log('STOP HERE. Do not start CARD.DRV yet.')
}

main().catch(err => {
  console.error(`\nBROADCAST STOPPED: ${err.message}`)
  console.error(`journal: ${journalPath}`)
  console.error('Do not rerun, do not use --resume, and do not send another deployer transaction until this state is reviewed.')
  process.exit(1)
})
