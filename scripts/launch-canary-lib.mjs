import { createHash } from 'node:crypto'

export const MAINNET_CANARY_SCHEMA = 'r3os-mainnet-canary/v1'
export const MAINNET_CHAIN_ID = 143
export const BYTES32 = /^0x[0-9a-fA-F]{64}$/

const plainObject = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value))
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!plainObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`
}

export function sha256Hex(value) {
  const text = typeof value === 'string' ? value : canonicalJson(value)
  return `0x${createHash('sha256').update(text).digest('hex')}`
}

export function stableDoctorEvidence(doctor) {
  const evidence = doctor?.evidence ?? {}
  return canonicalize({
    contracts: evidence.contracts ?? {},
    partners: evidence.partners ?? {},
    ownership: evidence.ownership ?? {},
    registry: evidence.registry ?? [],
    renderers: evidence.renderers ?? [],
    configuration: evidence.configuration ?? {},
    freezeStates: evidence.freezeStates ?? {},
  })
}

export function doctorDigest(doctor) {
  return sha256Hex(stableDoctorEvidence(doctor))
}

export function assessFinalizedAgreement(primary, secondary, sharedPrimary, sharedSecondary) {
  const errors = []
  if (Number(primary?.chainId) !== MAINNET_CHAIN_ID) errors.push('primary chainId must be 143')
  if (Number(secondary?.chainId) !== MAINNET_CHAIN_ID) errors.push('secondary chainId must be 143')
  if (primary?.height == null || secondary?.height == null) errors.push('both finalized heights are required')
  if (!BYTES32.test(String(sharedPrimary?.hash ?? ''))) errors.push('primary shared finalized hash is invalid')
  if (!BYTES32.test(String(sharedSecondary?.hash ?? ''))) errors.push('secondary shared finalized hash is invalid')
  if (sharedPrimary?.number == null || sharedSecondary?.number == null) errors.push('shared finalized block numbers are required')
  if (String(sharedPrimary?.number) !== String(sharedSecondary?.number)) errors.push('providers did not inspect the same shared finalized height')
  if (BYTES32.test(String(sharedPrimary?.hash ?? '')) && BYTES32.test(String(sharedSecondary?.hash ?? '')) && !same(sharedPrimary.hash, sharedSecondary.hash)) {
    errors.push('providers disagree on the shared finalized block hash')
  }

  const p = primary?.height == null ? 0n : BigInt(primary.height)
  const s = secondary?.height == null ? 0n : BigInt(secondary.height)
  const skew = p >= s ? p - s : s - p
  return {
    status: errors.length ? 'FAIL' : 'OK',
    errors,
    sharedBlockNumber: sharedPrimary?.number == null ? null : String(sharedPrimary.number),
    sharedBlockHash: errors.some((error) => error.includes('hash')) ? null : sharedPrimary?.hash ?? null,
    primaryFinalized: primary?.height == null ? null : String(primary.height),
    secondaryFinalized: secondary?.height == null ? null : String(secondary.height),
    finalizedHeightSkew: skew.toString(),
  }
}

export function decodeMonadCommit(value) {
  let current = plainObject(value) ? value : undefined
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const state = current.commitState
    const nestedLog = plainObject(current.log) ? current.log : undefined
    const source = nestedLog ?? current
    const hash = current.transactionHash ?? source.transactionHash
    if (['Proposed', 'Voted', 'Finalized', 'Verified'].includes(state)) {
      return {
        commitState: state,
        transactionHash: typeof hash === 'string' && BYTES32.test(hash) ? hash : undefined,
        blockNumber: current.blockNumber ?? source.blockNumber,
      }
    }
    const next = current.result ?? current.data ?? current.params
    current = plainObject(next) ? next : undefined
  }
  return undefined
}

export function summarizeChecks(checks) {
  const summary = { OK: 0, WARN: 0, FAIL: 0 }
  for (const check of checks ?? []) {
    if (check?.status in summary) summary[check.status] += 1
  }
  return summary
}

export function validateMainnetCanary(input, { requireTransaction = true } = {}) {
  const errors = []
  if (!plainObject(input)) return ['mainnet canary JSON is required']
  if (input.schema !== MAINNET_CANARY_SCHEMA) errors.push(`mainnet canary schema must be ${MAINNET_CANARY_SCHEMA}`)
  if (Number(input.chainId) !== MAINNET_CHAIN_ID) errors.push('mainnet canary chainId must be 143')
  if (input.exitCode !== 0) errors.push('mainnet canary exitCode must be 0')
  if (Number(input.summary?.FAIL ?? 1) !== 0) errors.push('mainnet canary must have zero FAIL checks')
  if (input.splitBrain?.status !== 'OK') errors.push('mainnet canary split-brain guard must be OK')
  if (!BYTES32.test(String(input.splitBrain?.sharedBlockHash ?? ''))) errors.push('mainnet canary shared finalized block hash is required')
  if (!BYTES32.test(String(input.providers?.primary?.evidenceHash ?? ''))) errors.push('mainnet canary primary evidence hash is required')
  if (!BYTES32.test(String(input.providers?.secondary?.evidenceHash ?? ''))) errors.push('mainnet canary secondary evidence hash is required')
  if (!same(input.providers?.primary?.evidenceHash, input.providers?.secondary?.evidenceHash)) errors.push('mainnet canary provider evidence hashes must match')
  const operational = input.operationalReads
  if (!plainObject(operational)) errors.push('mainnet canary operational reads are required')
  else {
    if (operational.budgetMatch !== true) errors.push('mainnet canary budgetOf reads must match across providers')
    if (operational.canaryHourlyBudgetSufficient !== true) errors.push('mainnet canary painter must have at least 2 hourly units available on both providers')
    if (operational.partnerBudgetMatch !== true) errors.push('mainnet canary partnerBudgetOf reads must match across providers')
    if (operational.passPointerMatch !== true) errors.push('mainnet canary Painter Pass pointer must match Paint through both providers')
    if (operational.pageMatch !== true) errors.push('mainnet canary PAGE.EXE readPage results must match across providers')
    if (!BYTES32.test(String(operational.primary?.pageHash ?? ''))) errors.push('mainnet canary PAGE.EXE page hash is required')
  }
  if (input.websocket?.connected !== true) errors.push('mainnet canary WebSocket connection must be healthy')
  if (input.websocket?.newHeadObserved !== true) errors.push('mainnet canary must observe a WebSocket newHeads notification')
  if (input.websocket?.monadLogsSubscribed !== true) errors.push('mainnet canary must establish a monadLogs subscription')

  if (requireTransaction) {
    if (input.mode !== 'transaction') errors.push('mainnet canary transaction mode is required')
    const tx = input.transaction
    if (!plainObject(tx) || tx.executed !== true) errors.push('mainnet canary transaction evidence is required')
    else {
      if (!BYTES32.test(String(tx.hash ?? ''))) errors.push('mainnet canary transaction hash must be bytes32')
      if (tx.receiptStatus !== 'success') errors.push('mainnet canary transaction receipt must be successful')
      if (tx.paintEventObserved !== true) errors.push('mainnet canary must observe the Painted log in the receipt')
      if (tx.proposedObserved !== true) errors.push('mainnet canary must observe Proposed through monadLogs')
      if (tx.finalizedObserved !== true) errors.push('mainnet canary must observe Finalized through monadLogs')
      if (tx.primaryFinalized !== true || tx.secondaryFinalized !== true) errors.push('mainnet canary transaction must finalize on both providers')
      if (tx.secondProviderReceipt !== true) errors.push('mainnet canary transaction receipt must be visible through the second provider')
      if (tx.secondProviderCanonicalBlock !== true) errors.push('mainnet canary transaction block must be canonical through the second provider')
      if (tx.visualStateRestored !== true) errors.push('mainnet canary must restore the canary pixel to its original visual state')
    }
  }
  return errors
}

export function parseCanaryArgs(argv, env = {}) {
  const out = { json: false, transaction: false, help: false }
  const take = (i) => argv[i + 1]
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--json') out.json = true
    else if (arg === '--transaction') out.transaction = true
    else if (arg === '--primary-rpc') out.primaryRpc = take(i++)
    else if (arg === '--secondary-rpc') out.secondaryRpc = take(i++)
    else if (arg === '--ws') out.wsUrl = take(i++)
    else if (arg === '--paint') out.paint = take(i++)
    else if (arg === '--expected-owner') out.expectedOwner = take(i++)
    else if (arg === '--expected-chain') out.expectedChain = Number(take(i++))
    else if (arg === '--account') out.account = take(i++)
    else out.unknown = [...(out.unknown ?? []), arg.startsWith('--') ? arg.split('=')[0] : '(positional)']
  }
  out.primaryRpc ??= env.RPC_URL
  out.secondaryRpc ??= env.RPC_URL_SECONDARY ?? env.SECONDARY_RPC_URL
  out.wsUrl ??= env.WS_URL ?? env.VITE_WS_URL
  out.paint ??= env.PAINT_ADDRESS
  out.expectedOwner ??= env.EXPECTED_OWNER ?? env.FINAL_OWNER
  out.expectedChain ??= Number(env.EXPECTED_CHAIN_ID || MAINNET_CHAIN_ID)
  out.account ??= env.CANARY_KEYSTORE_ACCOUNT
  return out
}
