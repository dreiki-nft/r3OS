#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
  http,
  isAddress,
  keccak256,
  parseAbi,
  toHex,
  webSocket,
} from 'viem'
import { runDoctor } from './launch-doctor-lib.mjs'
import {
  MAINNET_CANARY_SCHEMA,
  MAINNET_CHAIN_ID,
  assessFinalizedAgreement,
  decodeMonadCommit,
  doctorDigest,
  parseCanaryArgs,
  sha256Hex,
  summarizeChecks,
} from './launch-canary-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = parseCanaryArgs(process.argv.slice(2), process.env)
const secrets = [args.primaryRpc, args.secondaryRpc, args.wsUrl].filter(Boolean)

const HELP = `r3OS Phase 9D mainnet canary

read-only acceptance (default):
  RPC_URL=<primary> RPC_URL_SECONDARY=<secondary> WS_URL=<ws> npm run launch:canary -- --json

transaction canary (ONLY after a fresh explicit approval and a successful dry-run):
  CONFIRM_MAINNET=true CONFIRM_MAINNET_CANARY=true \\
  CANARY_KEYSTORE_ACCOUNT=<foundry-account> CANARY_X=<0..255> CANARY_Y=<0..255> CANARY_COLOR=<1..15> \\
  npm run launch:canary -- --transaction --json

The default mode never signs or sends. Transaction mode starts monadLogs observation before spawning the
approval-gated MainnetCanaryPaint Forge script. RPC/WS URLs are never written to the evidence artifact.`

if (args.help) {
  console.log(HELP)
  process.exit(0)
}
if (args.unknown?.length) {
  console.error(`unknown argument(s): ${args.unknown.join(' ')}\n\n${HELP}`)
  process.exit(2)
}
if (!args.primaryRpc || !args.secondaryRpc || !args.wsUrl || !isAddress(args.paint ?? '')) {
  console.error(`missing primary RPC, secondary RPC, WS URL, or PAINT_ADDRESS\n\n${HELP}`)
  process.exit(2)
}
if (Number(args.expectedChain) !== MAINNET_CHAIN_ID) {
  console.error('Phase 9D canary requires EXPECTED_CHAIN_ID=143')
  process.exit(2)
}
if (!isAddress(args.expectedOwner ?? '')) {
  console.error('Phase 9D canary requires a valid EXPECTED_OWNER / FINAL_OWNER')
  process.exit(2)
}
if (!isAddress(process.env.PASS_ADDRESS ?? '') || !isAddress(process.env.PAGE_EXE_ADDRESS ?? '')) {
  console.error('Phase 9D canary requires PASS_ADDRESS and PAGE_EXE_ADDRESS from artifacts/mainnet-addresses.env')
  process.exit(2)
}
if (args.primaryRpc === args.secondaryRpc) {
  console.error('primary and secondary RPC URLs must be distinct')
  process.exit(2)
}

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()
const safeMessage = (error) => {
  let text = String(error?.shortMessage ?? error?.message ?? error ?? 'unknown error')
  for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted-endpoint]')
  return text.replace(/\b(?:https?|wss?):\/\/[^\s)\]}]+/gi, '[redacted-endpoint]').slice(0, 500)
}
const withTimeout = async (promise, ms, label) => {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(resolve(root, path), 'utf8'))
  } catch {
    return undefined
  }
}

function programIds() {
  try {
    const source = readFileSync(resolve(root, 'src/os/programs.ts'), 'utf8')
    return [...source.matchAll(/^\s{4}id: '([a-z0-9-]+)'/gm)].map((match) => match[1])
  } catch {
    return []
  }
}

function makeClient(url) {
  return createPublicClient({ transport: http(url, { timeout: 20_000, retryCount: 1 }), cacheTime: 0 })
}

const abiCache = new Map()
const abiFor = (fragment) => {
  let abi = abiCache.get(fragment)
  if (!abi) abiCache.set(fragment, (abi = parseAbi([fragment])))
  return abi
}

function makeReader(client) {
  let finalizedBlockPromise
  const finalizedBlock = () =>
    (finalizedBlockPromise ??= client.getBlock({ blockTag: 'finalized' }).then((block) => {
      if (block.number == null || !block.hash) throw new Error('finalized block is incomplete')
      return block
    }))
  return {
    chainId: () => client.getChainId(),
    block: async () => {
      const block = await finalizedBlock()
      return { number: block.number, hash: block.hash, timestamp: block.timestamp, commitment: 'finalized' }
    },
    code: async (address) => {
      const block = await finalizedBlock()
      return client.getCode({ address, blockNumber: block.number })
    },
    codeHash: async (address) => {
      const block = await finalizedBlock()
      const code = await client.getCode({ address, blockNumber: block.number })
      return code && code !== '0x' ? keccak256(code) : undefined
    },
    read: async (address, fragment, values = []) => {
      const block = await finalizedBlock()
      const abi = abiFor(fragment)
      return client.readContract({ address, abi, functionName: abi[0].name, args: values, blockNumber: block.number })
    },
    call: async (to, data) => {
      const block = await finalizedBlock()
      return (await client.call({ to, data, blockNumber: block.number })).data
    },
  }
}

const venueManifest = readJson('src/router/mainnet-venues.json')
const releases = readJson('public/releases.json')
const knownProgramIds = programIds()
const primaryClient = makeClient(args.primaryRpc)
const secondaryClient = makeClient(args.secondaryRpc)

async function providerDoctor(client) {
  return runDoctor({
    reader: makeReader(client),
    paint: args.paint,
    expectedOwner: args.expectedOwner,
    expectedChain: MAINNET_CHAIN_ID,
    releases,
    knownProgramIds,
    venues: venueManifest?.venues ?? [],
    mrcRevision: venueManifest?.mrc17MipCommit,
  })
}

function publicDoctorSummary(doctor) {
  return {
    blockNumber: doctor?.block == null ? null : String(doctor.block),
    blockHash: doctor?.blockHash ?? null,
    commitment: doctor?.commitment ?? null,
    summary: doctor?.summary ?? null,
    exitCode: doctor?.exitCode ?? 1,
  }
}

async function sharedFinalizedAgreement(primaryDoctor, secondaryDoctor) {
  const primaryHeight = BigInt(primaryDoctor.block)
  const secondaryHeight = BigInt(secondaryDoctor.block)
  const shared = primaryHeight <= secondaryHeight ? primaryHeight : secondaryHeight
  const [primaryShared, secondaryShared, primaryChain, secondaryChain] = await Promise.all([
    primaryClient.getBlock({ blockNumber: shared }),
    secondaryClient.getBlock({ blockNumber: shared }),
    primaryClient.getChainId(),
    secondaryClient.getChainId(),
  ])
  return assessFinalizedAgreement(
    { chainId: primaryChain, height: primaryHeight },
    { chainId: secondaryChain, height: secondaryHeight },
    { number: primaryShared.number, hash: primaryShared.hash },
    { number: secondaryShared.number, hash: secondaryShared.hash },
  )
}

async function openWsSession({ keepMonadLogs = false } = {}) {
  const notifications = []
  let asyncError
  const client = createPublicClient({
    transport: webSocket(args.wsUrl, { reconnect: { attempts: 2, delay: 500 } }),
    cacheTime: 0,
  })
  await withTimeout(client.getBlockNumber({ cacheTime: 0 }), 7_500, 'WebSocket eth_blockNumber')
  const transport = client.transport
  if (typeof transport.subscribe !== 'function') throw new Error('WebSocket transport does not expose subscriptions')

  let resolveHead
  let rejectHead
  const headSeen = new Promise((resolve, reject) => {
    resolveHead = resolve
    rejectHead = reject
  })
  const headHandle = await withTimeout(
    transport.subscribe({
      params: ['newHeads'],
      onData: () => resolveHead(true),
      onError: (error) => rejectHead(error),
    }),
    5_000,
    'newHeads subscription setup',
  )
  await withTimeout(headSeen, 10_000, 'newHeads notification')
  await headHandle.unsubscribe()

  const monadHandle = await withTimeout(
    transport.subscribe({
      params: ['monadLogs', { address: [args.paint] }],
      onData: (data) => {
        const decoded = decodeMonadCommit(data)
        if (decoded) notifications.push({ ...decoded, observedAt: new Date().toISOString() })
      },
      onError: (error) => {
        asyncError = error
      },
    }),
    5_000,
    'monadLogs subscription setup',
  )
  await delay(300)
  if (asyncError) {
    await monadHandle.unsubscribe()
    throw asyncError
  }

  const close = async () => {
    try {
      await monadHandle.unsubscribe()
    } catch {}
  }
  if (!keepMonadLogs) await close()
  return { connected: true, newHeadObserved: true, monadLogsSubscribed: true, notifications, close }
}

function addCheck(checks, name, status, detail = '') {
  checks.push({ name, status, detail })
}

async function waitForReceipt(client, hash, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      return await client.getTransactionReceipt({ hash })
    } catch (error) {
      lastError = error
      await delay(300)
    }
  }
  throw lastError ?? new Error('transaction receipt timeout')
}

async function waitForFinalized(client, target, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    last = await client.getBlock({ blockTag: 'finalized' })
    if (last.number != null && last.number >= target) return last
    await delay(350)
  }
  throw new Error(`finalized head did not reach transaction block; last=${last?.number ?? 'unknown'}`)
}

function readBroadcastHash() {
  const run = readJson('contracts/broadcast/MainnetCanaryPaint.s.sol/143/run-latest.json')
  const candidates = [
    ...(run?.receipts ?? []).map((receipt) => receipt?.transactionHash),
    ...(run?.transactions ?? []).map((tx) => tx?.hash ?? tx?.transactionHash ?? tx?.transaction?.hash),
  ].filter((value) => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value))
  const unique = [...new Set(candidates.map((value) => value.toLowerCase()))]
  if (unique.length !== 1) throw new Error(`expected exactly one canary broadcast hash, found ${unique.length}`)
  return unique[0]
}

async function runForgeCanary() {
  if (process.env.CONFIRM_MAINNET !== 'true' || process.env.CONFIRM_MAINNET_CANARY !== 'true') {
    throw new Error('transaction mode requires CONFIRM_MAINNET=true and CONFIRM_MAINNET_CANARY=true after explicit approval')
  }
  if (!args.account) throw new Error('transaction mode requires CANARY_KEYSTORE_ACCOUNT or --account')
  for (const name of ['FINAL_OWNER', 'CANARY_X', 'CANARY_Y', 'CANARY_COLOR']) {
    if (!String(process.env[name] ?? '').trim()) throw new Error(`transaction mode requires ${name}`)
  }
  const command = process.platform === 'win32' ? 'forge.exe' : 'forge'
  const childArgs = [
    'script',
    'contracts/script/MainnetCanaryPaint.s.sol:MainnetCanaryPaint',
    '--root', 'contracts',
    '--rpc-url', args.primaryRpc,
    '--broadcast',
    '--slow',
    '--account', args.account,
    '--gas-estimate-multiplier', '175',
    '-vvvv',
  ]
  await new Promise((resolveChild, rejectChild) => {
    const child = spawn(command, childArgs, {
      cwd: root,
      stdio: 'inherit',
      shell: false,
      env: { ...process.env, FOUNDRY_PROFILE: 'deploy' },
    })
    child.on('error', rejectChild)
    child.on('exit', (code, signal) => {
      if (code === 0) resolveChild()
      else rejectChild(new Error(`Forge canary exited ${code ?? 'null'}${signal ? ` (${signal})` : ''}`))
    })
  })
  return readBroadcastHash()
}

const OPERATIONAL_ABI = {
  paint: parseAbi([
    'function budgetOf(address owner,uint256[] ids) view returns (uint256 hourlyAvailable,uint256 holderAvailable,uint256 totalAvailable,uint256 hourlyLimit,uint32 activeDays)',
    'function partnerBudgetOf(address owner) view returns (bool skrumpeyHolder,uint256 skrumpeyAvailable,bool monadCardHolder,uint256 monadCardAvailable)',
  ]),
  pass: parseAbi(['function PAINT() view returns (address)']),
  page: parseAbi(['function readPage(address owner) view returns (bytes32[128] words)']),
}

const stringifyTuple = (value) => Array.from(value ?? []).map((item) => typeof item === 'bigint' ? item.toString() : item)

async function operationalReads(blockNumber) {
  const owner = args.expectedOwner
  const pass = process.env.PASS_ADDRESS
  const page = process.env.PAGE_EXE_ADDRESS
  const readOne = async (client) => {
    const [budget, partnerBudget, passPaint, pageWords] = await Promise.all([
      client.readContract({ address: args.paint, abi: OPERATIONAL_ABI.paint, functionName: 'budgetOf', args: [owner, []], blockNumber }),
      client.readContract({ address: args.paint, abi: OPERATIONAL_ABI.paint, functionName: 'partnerBudgetOf', args: [owner], blockNumber }),
      client.readContract({ address: pass, abi: OPERATIONAL_ABI.pass, functionName: 'PAINT', blockNumber }),
      client.readContract({ address: page, abi: OPERATIONAL_ABI.page, functionName: 'readPage', args: [owner], blockNumber }),
    ])
    const pageValues = Array.from(pageWords ?? [])
    return {
      budget: stringifyTuple(budget),
      partnerBudget: stringifyTuple(partnerBudget),
      passPaint,
      pageHash: sha256Hex(pageValues.join('')),
      pageWords: pageValues.length,
    }
  }
  const [primary, secondary] = await Promise.all([readOne(primaryClient), readOne(secondaryClient)])
  return {
    blockNumber: blockNumber.toString(),
    primary, secondary,
    budgetMatch: JSON.stringify(primary.budget) === JSON.stringify(secondary.budget),
    canaryHourlyBudgetSufficient:
      BigInt(primary.budget[0] ?? '0') >= 2n && BigInt(secondary.budget[0] ?? '0') >= 2n,
    partnerBudgetMatch: JSON.stringify(primary.partnerBudget) === JSON.stringify(secondary.partnerBudget),
    passPointerMatch: same(primary.passPaint, args.paint) && same(secondary.passPaint, args.paint),
    pageMatch: primary.pageWords === 128 && secondary.pageWords === 128 && same(primary.pageHash, secondary.pageHash),
  }
}

const PAINT_READ_ABI = parseAbi([
  'function currentSeason() view returns (uint256)',
  'function backgroundPixelAt(uint256 season,uint256 x,uint256 y) view returns (uint8)',
  'function pixelAt(uint256 season,uint256 x,uint256 y) view returns (uint8)',
  'function getBackgroundCanvas(uint256 season) view returns (bytes)',
  'function getCanvas(uint256 season) view returns (bytes)',
  'function regionState(uint256 season,uint8 region) view returns (uint64 capBlock,uint32 pixelsInBlock,uint64 totalPaints,uint64 changeCounter,uint64 primaryPaints,uint256 pressure)',
  'function isStorm(uint256 blockNumber) pure returns (bool)',
  'function nextStormStart() view returns (uint256)',
])

function packedPixel(hex, x, y) {
  const pixel = y * 256 + x
  const byteIndex = Math.floor(pixel / 2)
  const offset = 2 + byteIndex * 2
  const byte = Number.parseInt(hex.slice(offset, offset + 2), 16)
  return (pixel & 1) === 0 ? byte >> 4 : byte & 0x0f
}

async function suggestCanaryCandidate(blockNumber) {
  const season = await primaryClient.readContract({
    address: args.paint, abi: PAINT_READ_ABI, functionName: 'currentSeason', blockNumber,
  })
  const [background, visible, regionStates, storm, nextStorm] = await Promise.all([
    primaryClient.readContract({ address: args.paint, abi: PAINT_READ_ABI, functionName: 'getBackgroundCanvas', args: [season], blockNumber }),
    primaryClient.readContract({ address: args.paint, abi: PAINT_READ_ABI, functionName: 'getCanvas', args: [season], blockNumber }),
    Promise.all(Array.from({ length: 16 }, (_, region) => primaryClient.readContract({
      address: args.paint, abi: PAINT_READ_ABI, functionName: 'regionState', args: [season, region], blockNumber,
    }))),
    primaryClient.readContract({ address: args.paint, abi: PAINT_READ_ABI, functionName: 'isStorm', args: [blockNumber], blockNumber }),
    primaryClient.readContract({ address: args.paint, abi: PAINT_READ_ABI, functionName: 'nextStormStart', blockNumber }),
  ])
  const ranked = regionStates
    .map((state, region) => ({ region, pressure: BigInt(state[5]), totalPaints: BigInt(state[2]), pixelsInBlock: BigInt(state[1]) }))
    .filter((item) => item.pressure <= 2n)
    .sort((a, b) => Number(a.pressure - b.pressure) || Number(a.totalPaints - b.totalPaints) || a.region - b.region)
  for (const item of ranked) {
    const regionRow = item.region >> 2
    const regionCol = item.region & 3
    for (let localY = 0; localY < 64; localY += 1) {
      const y = regionRow * 64 + localY
      for (let localX = 0; localX < 64; localX += 1) {
        const x = regionCol * 64 + localX
        if (packedPixel(background, x, y) === 0 && packedPixel(visible, x, y) === 0) {
          return {
            season: season.toString(),
            x, y, color: 1, region: item.region,
            pressure: item.pressure.toString(),
            totalPaints: item.totalPaints.toString(),
            pixelsInBlock: item.pixelsInBlock.toString(),
            observedAtFinalizedBlock: blockNumber.toString(),
            stormAtObservedBlock: Boolean(storm),
            blocksUntilNextStorm: (BigInt(nextStorm) - blockNumber).toString(),
            behavior: 'blank -> color -> blank in one transaction; final canvas image unchanged',
          }
        }
      }
    }
  }
  return null
}
const PAINTED_TOPIC = keccak256(toHex('Painted(uint256,address,address,bytes,bytes,uint32,uint16)'))

async function transactionEvidence(wsSession) {
  const x = Number(process.env.CANARY_X)
  const y = Number(process.env.CANARY_Y)
  const color = Number(process.env.CANARY_COLOR)
  const hash = await runForgeCanary()
  const [primaryReceipt, secondaryReceipt] = await Promise.all([
    waitForReceipt(primaryClient, hash),
    waitForReceipt(secondaryClient, hash),
  ])
  if (primaryReceipt.status !== 'success') throw new Error('primary canary receipt reverted')
  if (secondaryReceipt.status !== 'success') throw new Error('secondary canary receipt reverted')

  const [primaryFinalized, secondaryFinalized] = await Promise.all([
    waitForFinalized(primaryClient, primaryReceipt.blockNumber),
    waitForFinalized(secondaryClient, primaryReceipt.blockNumber),
  ])
  const [primaryBlock, secondaryBlock] = await Promise.all([
    primaryClient.getBlock({ blockNumber: primaryReceipt.blockNumber }),
    secondaryClient.getBlock({ blockNumber: primaryReceipt.blockNumber }),
  ])

  const season = await secondaryClient.readContract({
    address: args.paint,
    abi: PAINT_READ_ABI,
    functionName: 'currentSeason',
    blockNumber: primaryReceipt.blockNumber,
  })
  const [background, visible] = await Promise.all([
    secondaryClient.readContract({
      address: args.paint,
      abi: PAINT_READ_ABI,
      functionName: 'backgroundPixelAt',
      args: [season, BigInt(x), BigInt(y)],
      blockNumber: primaryReceipt.blockNumber,
    }),
    secondaryClient.readContract({
      address: args.paint,
      abi: PAINT_READ_ABI,
      functionName: 'pixelAt',
      args: [season, BigInt(x), BigInt(y)],
      blockNumber: primaryReceipt.blockNumber,
    }),
  ])

  const deadline = Date.now() + 12_000
  while (Date.now() < deadline) {
    const txStates = wsSession.notifications
      .filter((item) => same(item.transactionHash, hash))
      .map((item) => item.commitState)
    if (txStates.includes('Finalized')) break
    await delay(200)
  }
  const commitStates = [...new Set(wsSession.notifications
    .filter((item) => same(item.transactionHash, hash))
    .map((item) => item.commitState))]

  const paintEventObserved = primaryReceipt.logs.some(
    (log) => same(log.address, args.paint) && same(log.topics?.[0], PAINTED_TOPIC),
  )
  const canonical = Boolean(
    primaryBlock.hash &&
    secondaryBlock.hash &&
    same(primaryBlock.hash, secondaryBlock.hash) &&
    same(primaryBlock.hash, primaryReceipt.blockHash),
  )

  return {
    executed: true,
    hash,
    blockNumber: primaryReceipt.blockNumber.toString(),
    blockHash: primaryReceipt.blockHash,
    receiptStatus: primaryReceipt.status,
    paintEventObserved,
    commitStates,
    proposedObserved: commitStates.includes('Proposed'),
    votedObserved: commitStates.includes('Voted'),
    finalizedObserved: commitStates.includes('Finalized'),
    primaryFinalized: primaryFinalized.number >= primaryReceipt.blockNumber,
    secondaryFinalized: secondaryFinalized.number >= primaryReceipt.blockNumber,
    secondProviderReceipt: same(secondaryReceipt.transactionHash, hash),
    secondProviderCanonicalBlock: canonical,
    canary: { x, y, color, finalBackgroundColor: Number(background), finalVisibleColor: Number(visible) },
    visualStateRestored: Number(background) === 0 && Number(visible) === 0,
  }
}

const startedAt = new Date().toISOString()
const checks = []
let wsSession
let transaction = { executed: false }
let primaryDoctor
let secondaryDoctor
let splitBrain
let primaryEvidenceHash
let secondaryEvidenceHash
let suggestedTransactionCanary
let operational
let fatal

try {
  ;[primaryDoctor, secondaryDoctor] = await Promise.all([
    providerDoctor(primaryClient),
    providerDoctor(secondaryClient),
  ])
  addCheck(checks, 'primary Launch Doctor', primaryDoctor.exitCode === 0 && primaryDoctor.summary.FAIL === 0 ? 'OK' : 'FAIL', `FAIL=${primaryDoctor.summary.FAIL}`)
  addCheck(checks, 'secondary Launch Doctor', secondaryDoctor.exitCode === 0 && secondaryDoctor.summary.FAIL === 0 ? 'OK' : 'FAIL', `FAIL=${secondaryDoctor.summary.FAIL}`)

  primaryEvidenceHash = doctorDigest(primaryDoctor)
  secondaryEvidenceHash = doctorDigest(secondaryDoctor)
  addCheck(checks, 'provider deployment evidence', same(primaryEvidenceHash, secondaryEvidenceHash) ? 'OK' : 'FAIL', same(primaryEvidenceHash, secondaryEvidenceHash) ? 'MATCH' : 'MISMATCH')

  splitBrain = await sharedFinalizedAgreement(primaryDoctor, secondaryDoctor)
  addCheck(checks, 'shared finalized canonical block', splitBrain.status, splitBrain.status === 'OK' ? `#${splitBrain.sharedBlockNumber} ${splitBrain.sharedBlockHash}` : splitBrain.errors.join('; '))

  suggestedTransactionCanary = await suggestCanaryCandidate(BigInt(splitBrain.sharedBlockNumber))
  addCheck(checks, 'visually-idempotent Paint canary candidate', suggestedTransactionCanary ? 'OK' : 'FAIL', suggestedTransactionCanary ? `(${suggestedTransactionCanary.x},${suggestedTransactionCanary.y}) region ${suggestedTransactionCanary.region} pressure ${suggestedTransactionCanary.pressure}` : 'no blank low-pressure pixel found')

  operational = await operationalReads(BigInt(splitBrain.sharedBlockNumber))
  addCheck(checks, 'budgetOf cross-provider read', operational.budgetMatch ? 'OK' : 'FAIL')
  addCheck(
    checks,
    'canary hourly budget >= 2 units',
    operational.canaryHourlyBudgetSufficient ? 'OK' : 'FAIL',
    `primary=${operational.primary.budget[0] ?? '?'} secondary=${operational.secondary.budget[0] ?? '?'}`,
  )
  addCheck(checks, 'partnerBudgetOf cross-provider read', operational.partnerBudgetMatch ? 'OK' : 'FAIL')
  addCheck(checks, 'Painter Pass -> Paint read', operational.passPointerMatch ? 'OK' : 'FAIL')
  addCheck(checks, 'PAGE.EXE readPage cross-provider read', operational.pageMatch ? 'OK' : 'FAIL', operational.pageMatch ? operational.primary.pageHash : 'MISMATCH')

  wsSession = await openWsSession({ keepMonadLogs: args.transaction })
  addCheck(checks, 'WebSocket newHeads', wsSession.newHeadObserved ? 'OK' : 'FAIL')
  addCheck(checks, 'WebSocket monadLogs subscription', wsSession.monadLogsSubscribed ? 'OK' : 'FAIL')

  if (args.transaction) {
    if (checks.some((check) => check.status === 'FAIL')) throw new Error('read-only canary checks are not green; transaction mode blocked')
    transaction = await transactionEvidence(wsSession)
    addCheck(checks, 'canary transaction receipt', transaction.receiptStatus === 'success' ? 'OK' : 'FAIL')
    addCheck(checks, 'Painted event', transaction.paintEventObserved ? 'OK' : 'FAIL')
    addCheck(checks, 'monadLogs Proposed', transaction.proposedObserved ? 'OK' : 'FAIL')
    addCheck(checks, 'monadLogs Voted', transaction.votedObserved ? 'OK' : 'WARN', transaction.votedObserved ? '' : 'optional state not observed')
    addCheck(checks, 'monadLogs Finalized', transaction.finalizedObserved ? 'OK' : 'FAIL')
    addCheck(checks, 'transaction finalized on both providers', transaction.primaryFinalized && transaction.secondaryFinalized ? 'OK' : 'FAIL')
    addCheck(checks, 'second-provider receipt', transaction.secondProviderReceipt ? 'OK' : 'FAIL')
    addCheck(checks, 'second-provider canonical block', transaction.secondProviderCanonicalBlock ? 'OK' : 'FAIL')
    addCheck(checks, 'canary visual state restored', transaction.visualStateRestored ? 'OK' : 'FAIL')
  }
} catch (error) {
  fatal = safeMessage(error)
  addCheck(checks, args.transaction ? 'transaction canary' : 'read-only canary', 'FAIL', fatal)
} finally {
  if (wsSession?.close) await wsSession.close()
}

const summary = summarizeChecks(checks)
const artifact = {
  schema: MAINNET_CANARY_SCHEMA,
  mode: args.transaction ? 'transaction' : 'read-only',
  readOnly: !args.transaction,
  chainId: MAINNET_CHAIN_ID,
  startedAt,
  completedAt: new Date().toISOString(),
  providers: {
    primary: {
      doctor: publicDoctorSummary(primaryDoctor),
      evidenceHash: primaryEvidenceHash ?? null,
    },
    secondary: {
      doctor: publicDoctorSummary(secondaryDoctor),
      evidenceHash: secondaryEvidenceHash ?? null,
    },
  },
  splitBrain: splitBrain ?? { status: 'FAIL', errors: fatal ? [fatal] : ['split-brain check unavailable'] },
  operationalReads: operational ?? null,
  websocket: {
    connected: wsSession?.connected === true,
    newHeadObserved: wsSession?.newHeadObserved === true,
    monadLogsSubscribed: wsSession?.monadLogsSubscribed === true,
  },
  suggestedTransactionCanary: suggestedTransactionCanary ?? null,
  transaction,
  checks,
  summary,
  exitCode: summary.FAIL === 0 ? 0 : 1,
}

const outDir = resolve(root, 'artifacts')
mkdirSync(outDir, { recursive: true })
const outName = args.transaction ? 'mainnet-canary.json' : 'mainnet-canary-readonly.json'
writeFileSync(resolve(outDir, outName), `${JSON.stringify(artifact, null, 2)}\n`)

if (args.json) console.log(JSON.stringify(artifact, null, 2))
else {
  console.log(`r3OS Phase 9D canary: ${artifact.exitCode === 0 ? 'PASS' : 'FAIL'}`)
  console.log(`mode: ${artifact.mode}`)
  console.log(`shared finalized: #${artifact.splitBrain.sharedBlockNumber ?? '?'} ${artifact.splitBrain.sharedBlockHash ?? '?'}`)
  console.log(`provider evidence: ${same(primaryEvidenceHash, secondaryEvidenceHash) ? 'MATCH' : 'MISMATCH'}`)
  console.log(`WebSocket: ${artifact.websocket.connected ? 'connected' : 'failed'} · monadLogs ${artifact.websocket.monadLogsSubscribed ? 'subscribed' : 'failed'}`)
  if (args.transaction) console.log(`transaction: ${transaction.hash ?? 'none'} · ${transaction.receiptStatus ?? 'unknown'}`)
  console.log(`summary: ${summary.OK} OK · ${summary.WARN} WARN · ${summary.FAIL} FAIL`)
  console.log(`wrote artifacts/${outName}`)
}
process.exit(artifact.exitCode)
