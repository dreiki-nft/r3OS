// Launch Doctor: pure logic + the read-only check runner.
// No writes, no signing, no wallet. Every read goes through an injected `reader`, so the whole
// report can be unit-tested with fixtures (scripts/launch-doctor.test.ts) without any RPC.

export const STATUS = Object.freeze({ OK: 'OK', WARN: 'WARN', FAIL: 'FAIL', UNKNOWN: 'UNKNOWN' })
const ZERO = '0x0000000000000000000000000000000000000000'
const UINT256_MAX = (1n << 256n) - 1n

// ---------------------------------------------------------------------------
// Expectations derived from the snapshot's deployment scripts
// ---------------------------------------------------------------------------

/** Registry names exactly as the deploy scripts register them (note "finale auction" has a space). */
export const EXPECTED_EXPERIMENTS = Object.freeze([
  { name: 'flipbook', script: 'Deploy.s.sol' },
  { name: 'weeds', script: 'Deploy.s.sol' },
  { name: 'forks', script: 'Deploy.s.sol' },
  { name: 'brushes', script: 'Deploy.s.sol' },
  { name: 'finale auction', script: 'Deploy.s.sol' },
  { name: 'quests', script: 'Deploy.s.sol' },
  { name: 'sleepwalker', script: 'Deploy.s.sol' },
  { name: 'recycle-bin', script: 'Deploy.s.sol' },
  { name: 'cd-burner', script: 'Deploy.s.sol' },
  { name: 'card-drv', script: 'DeployMonadCard.s.sol' },
  { name: 'page-exe', script: 'DeployMonadHW.s.sol' },
  { name: 'block-camera', script: 'DeployMonadHW.s.sol' },
  { name: 'kernel-debugger', script: 'DeployMonadHW.s.sol' },
  { name: 'operator-record', script: 'DeployOperator.s.sol' },
  { name: 'system-event', script: 'DeployOperator.s.sol' },
  { name: 'router-lab', script: 'DeployRouterLab.s.sol' },
])

/** Test-only registry entries: expected off-mainnet, never on chain 143. */
export const TEST_ONLY_EXPERIMENTS = Object.freeze(['router-mock-venues'])

/** Renderer registry: index 0 is the core's built-in renderer (address 0), then Deploy.s.sol adds three. */
export const EXPECTED_RENDERERS = Object.freeze(['built-in', 'diff', 'season timelapse', 'df1'])

/** Pass stamp sources in deploy order (Deploy.s.sol, then DeployMonadCard.s.sol). Pin = 6 + index. */
export const EXPECTED_STAMP_SOURCES = Object.freeze([
  'flipbook',
  'weeds',
  'forks',
  'brushes',
  'quests',
  'sleepwalker',
  'recycle-bin',
  'card-drv',
])

/** From R3tardsPainterPass / PassArt: six built-in pins, then one pin per stamp source, 16 drawn. */
export const PASS_BUILTIN_PINS = 6
export const PASS_MAX_PINS = 16
/** Policy (docs/PRE_MAINNET_CHECKLIST.md): the last two visual pins stay unassigned. */
export const PASS_RESERVED_PINS = 2

/** Labs bound to their registry id with bindExperimentId(). */
export const BOUND_EXPERIMENTS = Object.freeze([
  'flipbook',
  'forks',
  'sleepwalker',
  'recycle-bin',
  'cd-burner',
  'block-camera',
])

/** Operator Record v1 source immutable → the registry entry (or core pointer) it must equal. */
export const OPERATOR_SOURCES = Object.freeze([
  { fn: 'PAINT', target: 'core:paint' },
  { fn: 'PASS', target: 'core:pass' },
  { fn: 'FLIPBOOK', target: 'flipbook' },
  { fn: 'WEEDS', target: 'weeds' },
  { fn: 'FORKS', target: 'forks' },
  { fn: 'BRUSHES', target: 'brushes' },
  { fn: 'AUCTION', target: 'finale auction' },
  { fn: 'QUESTS', target: 'quests' },
  { fn: 'SLEEPWALKER', target: 'sleepwalker' },
  { fn: 'RECYCLE_BIN', target: 'recycle-bin' },
  { fn: 'PAGE_EXE', target: 'page-exe' },
  { fn: 'BLOCK_CAMERA', target: 'block-camera' },
  { fn: 'KERNEL_DEBUGGER', target: 'kernel-debugger' },
  { fn: 'CARD_MEMORY', target: 'card-drv' },
  { fn: 'MONAD_CARD', target: 'card:monad-card' },
])

export const OFFICIAL = Object.freeze({
  monadCard: '0x0000CA12D5c07085022eBC74867157449919Fd67',
  monUsdFeed: '0xBcD78f76005B7515837af6b50c7C52BCf73822fb',
  multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
})

export const MONAD_DEVICES = Object.freeze({
  staking: '0x0000000000000000000000000000000000001000',
  reserve: '0x0000000000000000000000000000000000001001',
  p256: '0x0000000000000000000000000000000000000100',
  history: '0x0000F90827F1C53a10cb7A02335B175320002935',
})

/** Checks this tool cannot perform: they need real chain behaviour, a mainnet fork or the live oracle. */
export const EXTERNAL_CHECKS = Object.freeze([
  {
    kind: 'TESTNET REQUIRED',
    items: [
      'block.coinbase semantics (frame "Sealed by")',
      'EIP-2935 historical block-hash correctness and 8,191-block window',
      'auction close-hash path and candle-start fallback',
      'MIP-4 reserve enforcement (Kernel Debugger BURST NAIVE)',
      'production gas limits from real distributions',
      'public RPC soak: bounded getLogs, idle rates, ws → polling fallback',
    ],
  },
  {
    kind: 'MAINNET FORK REQUIRED',
    items: [
      'official Monad Card behaviour (MonadCardFork)',
      'real MRC-17 adapters and quote isolation (RouterLabFork)',
    ],
  },
  { kind: 'MAINNET ORACLE CHECK', items: ['real MON/USD feed freshness, heartbeat and answer semantics'] },
])

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

export function sameAddress(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase()
}

export function isZero(address) {
  return !address || sameAddress(address, ZERO)
}

/** Untrusted strings from the chain: drop control characters and cap the length. */
export function boundString(value, max = 96) {
  if (value == null) return ''
  const text = String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * Removes anything that could leak an endpoint or credential: the given secrets verbatim, any URL,
 * and long hex strings that look like private keys (64 hex chars not part of a 0x-prefixed hash/address
 * context are still public data, so only `0x` + 64 hex preceded by "key" is redacted).
 */
export function redact(text, secrets = []) {
  let out = String(text)
  for (const secret of secrets) {
    if (secret && String(secret).length >= 4) out = out.split(String(secret)).join('[redacted]')
  }
  out = out.replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, '[redacted-url]')
  out = out.replace(
    /(private[_ ]?key|secret|token|apikey|api_key)(["'\s:=]+)(0x)?[0-9a-z_-]{16,}/gi,
    '$1$2[redacted]',
  )
  return out
}

export function short(address) {
  return typeof address === 'string' && address.length === 42
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : String(address ?? '—')
}

export function summarize(checks) {
  const summary = { OK: 0, WARN: 0, FAIL: 0, UNKNOWN: 0 }
  for (const check of checks) summary[check.status] = (summary[check.status] ?? 0) + 1
  return summary
}

export function exitCodeFor(summary) {
  return summary.FAIL > 0 ? 1 : 0
}

export function codeHashState({ hasCode, codeHash, expected }) {
  if (hasCode === false) return 'NO CODE'
  if (hasCode == null || !codeHash || !expected) return 'UNKNOWN'
  return codeHash.toLowerCase() === expected.toLowerCase() ? 'MATCH' : 'DIFFERS'
}

/** Owner / pending owner against an optional expected owner. */
export function ownershipCheck({ owner, pendingOwner, expected }) {
  if (!owner) return { status: STATUS.UNKNOWN, value: 'unreadable' }
  if (isZero(owner)) return { status: STATUS.FAIL, value: 'renounced (zero owner)' }
  const pending = pendingOwner && !isZero(pendingOwner)
  if (expected) {
    if (sameAddress(owner, expected)) {
      return pending
        ? {
            status: STATUS.WARN,
            value: `${short(owner)} · pending ${short(pendingOwner)}`,
            detail: 'a second transfer is pending',
          }
        : { status: STATUS.OK, value: short(owner) }
    }
    if (pending && sameAddress(pendingOwner, expected)) {
      return {
        status: STATUS.WARN,
        value: `${short(owner)} → pending ${short(pendingOwner)}`,
        detail: 'expected owner has not accepted yet',
      }
    }
    return { status: STATUS.FAIL, value: short(owner), detail: `expected ${short(expected)}` }
  }
  return pending
    ? {
        status: STATUS.WARN,
        value: `${short(owner)} · pending ${short(pendingOwner)}`,
        detail: 'transfer not accepted yet',
      }
    : { status: STATUS.OK, value: short(owner), detail: 'no expected owner given' }
}

/** Registry analysis: entries are { id, name, address, retired, hasCode }. */
export function analyzeExperiments(entries, { chainId } = {}) {
  const active = entries.filter((entry) => !entry.retired)
  const byName = new Map()
  for (const entry of active) byName.set(entry.name, [...(byName.get(entry.name) ?? []), entry])
  const byAddress = new Map()
  for (const entry of active) {
    if (isZero(entry.address)) continue
    const key = entry.address.toLowerCase()
    byAddress.set(key, [...(byAddress.get(key) ?? []), entry])
  }
  const expectedNames = EXPECTED_EXPERIMENTS.map((entry) => entry.name)
  const duplicateActiveNames = [...byName.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([name]) => name)
  const duplicateActiveAddresses = [...byAddress.values()]
    .filter((list) => list.length > 1)
    .map((list) => list.map((e) => e.name).join(' = '))
  const missing = expectedNames.filter(
    (name) => !byName.has(name) && !entries.some((entry) => entry.name === name),
  )
  const retiredExpected = expectedNames.filter(
    (name) => !byName.has(name) && entries.some((entry) => entry.name === name && entry.retired),
  )
  const zeroAddress = active.filter((entry) => isZero(entry.address)).map((entry) => entry.name)
  const noCode = active
    .filter((entry) => !isZero(entry.address) && entry.hasCode === false)
    .map((entry) => entry.name)
  const unknownCode = active
    .filter((entry) => !isZero(entry.address) && entry.hasCode == null)
    .map((entry) => entry.name)
  const known = new Set([...expectedNames, ...TEST_ONLY_EXPERIMENTS])
  const unexpected = active.filter((entry) => !known.has(entry.name)).map((entry) => entry.name)
  const testOnlyOnMainnet =
    chainId === 143
      ? active.filter((entry) => TEST_ONLY_EXPERIMENTS.includes(entry.name)).map((e) => e.name)
      : []
  /** The app resolves a name to its last active entry, exactly like src/chain/contracts.ts. */
  const resolved = {}
  for (const entry of active) if (!isZero(entry.address)) resolved[entry.name] = entry
  return {
    duplicateActiveNames,
    duplicateActiveAddresses,
    missing,
    retiredExpected,
    zeroAddress,
    noCode,
    unknownCode,
    unexpected,
    testOnlyOnMainnet,
    resolved,
  }
}

export function passCapacity({ sourceCount, builtin = PASS_BUILTIN_PINS, maxPins = PASS_MAX_PINS }) {
  const wanted = builtin + sourceCount
  const used = Math.min(maxPins, wanted)
  return {
    builtin,
    sources: sourceCount,
    used,
    maxPins,
    remaining: maxPins - used,
    metadataOnly: Math.max(0, wanted - maxPins),
  }
}

export function rendererReadiness({ names, frozen, unreadable = 0 }) {
  const missing = EXPECTED_RENDERERS.filter((name) => !names.includes(name))
  const extra = names.filter((name) => !EXPECTED_RENDERERS.includes(name))
  // A missing name may sit in an unreadable slot: only a fully read registry can prove it absent.
  const status = missing.length === 0 ? STATUS.OK : unreadable > 0 ? STATUS.UNKNOWN : STATUS.FAIL
  return { complete: missing.length === 0, missing, extra, frozen: Boolean(frozen), unreadable, status }
}

/** Strict positive chain id: digits only, no sign, no leading zero, safe integer. */
export function parseChainId(value) {
  if (value == null) return undefined
  const text = String(value).trim()
  if (!/^[1-9][0-9]{0,15}$/.test(text)) return null
  const id = Number(text)
  return Number.isSafeInteger(id) ? id : null
}

/** Operator intent vs the chain actually queried. Intent never changes which semantic rules apply. */
export function chainIntentCheck({ actual, expected }) {
  if (expected == null)
    return {
      status: STATUS.WARN,
      value: 'not specified',
      detail: 'pass --expected-chain to verify operator intent',
    }
  if (actual == null)
    return { status: STATUS.UNKNOWN, value: `expected ${expected}`, detail: 'actual chain unreadable' }
  return actual === expected
    ? { status: STATUS.OK, value: `${actual} = expected` }
    : { status: STATUS.FAIL, value: `actual ${actual} ≠ expected ${expected}`, detail: 'WRONG CHAIN' }
}

/**
 * Aggregate of individually checked items. A proven mismatch dominates; otherwise any unresolved item
 * keeps the aggregate UNKNOWN. Only a fully resolved, fully matching set is OK.
 */
export function aggregateMatches({ matched, mismatched, unresolved }) {
  const parts = []
  if (mismatched) parts.push(`${mismatched} mismatch`)
  if (unresolved) parts.push(`${unresolved} unresolved`)
  if (matched && (mismatched || unresolved)) parts.unshift(`${matched} match`)
  if (mismatched) return { status: STATUS.FAIL, value: parts.join(' · ') }
  if (unresolved) return { status: STATUS.UNKNOWN, value: parts.join(' · ') }
  return { status: STATUS.OK, value: matched ? 'MATCH' : 'nothing to compare' }
}

/** releases.json validation. `knownIds` are program ids from src/os/programs.ts. */
export function validateReleases(config, knownIds, now = Date.now()) {
  const rows = []
  const programs =
    config &&
    typeof config === 'object' &&
    config.programs &&
    typeof config.programs === 'object' &&
    !Array.isArray(config.programs)
      ? config.programs
      : undefined
  if (!programs)
    return { ok: false, rows: [{ id: '(file)', status: STATUS.FAIL, value: 'malformed releases.json' }] }
  for (const [id, date] of Object.entries(programs)) {
    const revealAt = typeof date === 'string' ? Date.parse(date) : NaN
    if (!knownIds.includes(id)) rows.push({ id, status: STATUS.FAIL, value: 'unknown program id' })
    else if (!Number.isFinite(revealAt))
      rows.push({ id, status: STATUS.FAIL, value: `malformed date "${boundString(date, 40)}"` })
    else if (revealAt > now)
      rows.push({
        id,
        status: STATUS.OK,
        value: `hidden until ${new Date(revealAt).toISOString()}`,
        hidden: true,
      })
    else
      rows.push({
        id,
        status: STATUS.WARN,
        value: `date passed (${new Date(revealAt).toISOString()}): no longer delays anything`,
        hidden: false,
      })
  }
  return { ok: rows.every((row) => row.status !== STATUS.FAIL), rows }
}

export function questMatchesCardCarrier(quest, { monadCard, paint }) {
  if (!quest || !Array.isArray(quest.conditions) || quest.conditions.length !== 2) return false
  const [card, pixels] = quest.conditions
  return (
    sameAddress(card.target, monadCard) &&
    String(card.selector).toLowerCase() === '0x70a08231' && // balanceOf(address)
    Number(card.word) === 0 &&
    Number(card.op) === 0 &&
    BigInt(card.threshold) === 1n &&
    sameAddress(pixels.target, paint) &&
    String(pixels.selector).toLowerCase() === '0x4d97621f' && // painterStats(address)
    Number(pixels.word) === 2 &&
    Number(pixels.op) === 0 &&
    BigInt(pixels.threshold) === 143n
  )
}

// ---------------------------------------------------------------------------
// Report model
// ---------------------------------------------------------------------------

export function createReport() {
  const sections = []
  let current
  return {
    sections,
    section(name) {
      current = { name, checks: [] }
      sections.push(current)
      return current
    },
    add(label, status, value = '', detail = '') {
      if (!current) this.section('GENERAL')
      current.checks.push({ label, status, value: boundString(value, 140), detail: boundString(detail, 160) })
    },
    info(label, value) {
      if (!current) this.section('GENERAL')
      current.checks.push({ label, status: 'INFO', value: boundString(value, 140), detail: '' })
    },
  }
}

export function allChecks(report) {
  return report.sections.flatMap((section) => section.checks).filter((check) => check.status !== 'INFO')
}

export function formatHuman(result, { secrets = [] } = {}) {
  const width = 30
  const lines = [
    'R3TARDS LAUNCH DOCTOR',
    `chain ${result.chain.id ?? '?'} (${result.chain.name}) · expected ${result.chain.expectedId ?? 'not specified'} · block ${result.block ?? '?'}`,
    'read-only: no transaction, signature or wallet access',
    '',
  ]
  for (const section of result.sections) {
    if (!section.checks.length) continue
    lines.push(section.name)
    for (const check of section.checks) {
      const label = `${check.label} `.padEnd(width, '.')
      const status = check.status === 'INFO' ? '' : check.status
      const value = [check.value, status && check.value ? `· ${status}` : status].filter(Boolean).join(' ')
      lines.push(`${label} ${value}`)
      if (check.detail) lines.push(`${' '.repeat(width + 1)}${check.detail}`)
    }
    lines.push('')
  }
  lines.push('OUTSIDE THIS TOOL (not verified by code presence)')
  for (const group of result.external) {
    lines.push(`${group.kind}`)
    for (const item of group.items) lines.push(`  - ${item}`)
  }
  lines.push('')
  lines.push('RESULT')
  for (const key of ['OK', 'WARN', 'FAIL', 'UNKNOWN']) lines.push(`${key.padEnd(8)}${result.summary[key]}`)
  return redact(lines.join('\n'), secrets)
}

export function toJson(result, { secrets = [] } = {}) {
  const json = JSON.stringify(
    {
      tool: 'r3tards-launch-doctor',
      readOnly: true,
      chain: result.chain,
      block: result.block == null ? null : String(result.block),
      sections: result.sections,
      external: result.external,
      summary: result.summary,
      exitCode: result.exitCode,
    },
    (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
    2,
  )
  return redact(json, secrets)
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * reader: {
 *   chainId(): Promise<number>
 *   block(): Promise<{ number: bigint, timestamp: bigint }>
 *   code(address): Promise<string | undefined>      // '0x' or undefined when empty
 *   codeHash(address): Promise<string | undefined>
 *   read(address, fragment, args?): Promise<any>     // fragment: 'function name(...) view returns (...)'
 *   call(to, data): Promise<string | undefined>      // raw eth_call
 * }
 */
export async function runDoctor({
  reader,
  paint,
  expectedOwner,
  expectedChain,
  releases,
  knownProgramIds = [],
  venues = [],
  mrcRevision,
  now = Date.now(),
}) {
  const report = createReport()
  const safe = async (fn) => {
    try {
      const value = await fn()
      return { ok: true, value }
    } catch (error) {
      return { ok: false, error: boundString(error?.shortMessage ?? error?.message ?? error, 120) }
    }
  }
  const read = (address, fragment, args = []) => safe(() => reader.read(address, fragment, args))
  const hasCode = async (address) => {
    const result = await safe(() => reader.code(address))
    if (!result.ok) return undefined
    return Boolean(result.value && result.value !== '0x')
  }
  const addr = (result) => (result.ok && typeof result.value === 'string' ? result.value : undefined)
  const codeStatus = (present) =>
    present === true ? STATUS.OK : present === false ? STATUS.FAIL : STATUS.UNKNOWN

  // ---- CHAIN
  report.section('CHAIN')
  const chainResult = await safe(() => reader.chainId())
  const chainId = chainResult.ok ? Number(chainResult.value) : undefined
  const chainName =
    chainId === 143 ? 'mainnet' : chainId === 10143 ? 'testnet' : chainId == null ? 'unknown' : 'local/other'
  report.add(
    'Actual chain',
    chainId == null ? STATUS.UNKNOWN : STATUS.OK,
    chainId == null ? 'unreadable' : `${chainId} (${chainName})`,
  )
  report.info('Expected chain', expectedChain == null ? 'not specified' : String(expectedChain))
  const intent = chainIntentCheck({ actual: chainId, expected: expectedChain })
  report.add(
    expectedChain == null ? 'Chain intent' : 'Chain match',
    intent.status,
    intent.value,
    intent.detail,
  )
  // Mainnet-only contract rules use the ACTUAL chain; --expected-chain is only an intent check.
  const chainKnown = chainId != null
  const blockResult = await safe(() => reader.block())
  const block = blockResult.ok ? blockResult.value : undefined
  report.add('Latest block', block ? STATUS.OK : STATUS.UNKNOWN, block ? String(block.number) : 'unreadable')
  const live = chainId === 143 || chainId === 10143
  const multicallCode = await hasCode(OFFICIAL.multicall3)
  report.add(
    'Multicall3 (canonical)',
    multicallCode === true
      ? STATUS.OK
      : multicallCode == null || !chainKnown
        ? STATUS.UNKNOWN
        : live
          ? STATUS.FAIL
          : STATUS.WARN,
    multicallCode === true ? 'code present' : multicallCode == null ? 'unreadable' : 'no code',
    live || multicallCode !== false ? '' : 'local chains use VITE_MULTICALL3_ADDRESS instead',
  )
  const historyCode = await hasCode(MONAD_DEVICES.history)
  report.add(
    'EIP-2935 contract',
    historyCode === true
      ? STATUS.OK
      : historyCode == null || !chainKnown
        ? STATUS.UNKNOWN
        : live
          ? STATUS.FAIL
          : STATUS.WARN,
    historyCode === true ? 'code present' : historyCode == null ? 'unreadable' : 'no code',
  )
  report.add(
    'EIP-2935 history behaviour',
    STATUS.UNKNOWN,
    'TESTNET CHECK REQUIRED',
    'code presence does not prove historical hashes are correct',
  )

  // ---- CORE
  report.section('CORE')
  const paintCode = await hasCode(paint)
  report.add(
    'Paint',
    codeStatus(paintCode),
    `${short(paint)} · ${paintCode ? 'code' : paintCode === false ? 'NO CODE' : 'unreadable'}`,
  )
  if (paintCode !== true) return finish(report, { chainId, chainName, block, expectedChain })
  const P = (fragment, args) => read(paint, fragment, args)
  const [
    owner,
    pending,
    r3tards,
    passRes,
    season,
    count,
    renderers,
    rFrozen,
    eFrozen,
    tokenZero,
    royaltyReceiver,
    royaltyBps,
    seasonStart,
    seasonLength,
  ] = await Promise.all([
    P('function owner() view returns (address)'),
    P('function pendingOwner() view returns (address)'),
    P('function R3TARDS() view returns (address)'),
    P('function painterPass() view returns (address)'),
    P('function currentSeason() view returns (uint256)'),
    P('function experimentCount() view returns (uint256)'),
    P('function rendererCount() view returns (uint256)'),
    P('function renderersFrozen() view returns (bool)'),
    P('function experimentsFrozen() view returns (bool)'),
    P('function ownerOf(uint256) view returns (address)', [0n]),
    P('function ROYALTY_RECEIVER() view returns (address)'),
    P('function ROYALTY_BPS() view returns (uint16)'),
    P('function SEASON_START() view returns (uint64)'),
    P('function SEASON_LENGTH() view returns (uint256)'),
  ])
  const passAddress = addr(passRes)
  const r3Code = r3tards.ok ? await hasCode(r3tards.value) : undefined
  report.add(
    'R3TARDS collection',
    r3tards.ok ? codeStatus(r3Code) : STATUS.UNKNOWN,
    r3tards.ok ? `${short(r3tards.value)}${r3Code === false ? ' · NO CODE' : ''}` : 'unreadable',
  )
  report.add(
    'Painter Pass pointer',
    passAddress && !isZero(passAddress) ? STATUS.OK : passRes.ok ? STATUS.FAIL : STATUS.UNKNOWN,
    passAddress ? short(passAddress) : 'unreadable',
  )
  report.add(
    'Current season',
    season.ok ? STATUS.OK : STATUS.UNKNOWN,
    season.ok ? String(season.value) : 'unreadable',
  )
  report.add(
    'Season config',
    seasonStart.ok && seasonLength.ok ? STATUS.OK : STATUS.UNKNOWN,
    seasonStart.ok && seasonLength.ok
      ? `start ${new Date(Number(seasonStart.value) * 1000).toISOString()} · length ${seasonLength.value}s`
      : 'unreadable',
  )
  report.add(
    'Token #0',
    tokenZero.ok
      ? expectedOwner && !sameAddress(tokenZero.value, expectedOwner)
        ? STATUS.WARN
        : STATUS.OK
      : STATUS.UNKNOWN,
    tokenZero.ok ? `owner ${short(tokenZero.value)}` : 'unreadable',
    tokenZero.ok && expectedOwner && !sameAddress(tokenZero.value, expectedOwner)
      ? 'not the expected owner; confirm TOKEN_ZERO_RECIPIENT was intended'
      : '',
  )
  report.add(
    'Royalty (Paint)',
    royaltyReceiver.ok && royaltyBps.ok
      ? expectedOwner && !sameAddress(royaltyReceiver.value, expectedOwner)
        ? STATUS.WARN
        : STATUS.OK
      : STATUS.UNKNOWN,
    royaltyReceiver.ok && royaltyBps.ok
      ? `${short(royaltyReceiver.value)} · ${Number(royaltyBps.value) / 100}%`
      : 'unreadable',
    royaltyReceiver.ok && expectedOwner && !sameAddress(royaltyReceiver.value, expectedOwner)
      ? 'receiver is not the expected project wallet'
      : '',
  )

  // ---- REGISTRY
  report.section('REGISTRY')
  const entries = []
  if (count.ok) {
    const n = Number(count.value)
    for (let i = 0; i < n && i < 256; i++) {
      const info = await P(
        'function experimentInfo(uint256) view returns ((address experiment,string name,string uri,bool retired))',
        [BigInt(i)],
      )
      if (!info.ok) {
        entries.push({
          id: i,
          name: `#${i} (unreadable)`,
          address: ZERO,
          retired: false,
          hasCode: undefined,
          unreadable: true,
        })
        continue
      }
      const value = info.value
      const address = value.experiment ?? value[0]
      const name = boundString(value.name ?? value[1], 48)
      const retired = Boolean(value.retired ?? value[3])
      entries.push({
        id: i,
        name,
        address,
        uri: boundString(value.uri ?? value[2], 80),
        retired,
        hasCode: isZero(address) ? false : await hasCode(address),
      })
    }
  }
  const registry = analyzeExperiments(
    entries.filter((entry) => !entry.unreadable),
    { chainId },
  )
  // Absence (missing / no duplicates) is only proven when every registry slot was read.
  const registryComplete = count.ok && !entries.some((entry) => entry.unreadable)
  const absent = (found) => (found ? STATUS.FAIL : registryComplete ? STATUS.OK : STATUS.UNKNOWN)
  const absentValue = (list) =>
    list.length ? list.join(', ') : registryComplete ? '0' : 'unproven (registry not fully read)'
  report.add(
    'Experiments',
    count.ok ? STATUS.OK : STATUS.UNKNOWN,
    count.ok
      ? `${entries.length} entries · ${entries.filter((e) => !e.retired).length} active`
      : 'unreadable',
  )
  if (entries.some((entry) => entry.unreadable))
    report.add(
      'Unreadable entries',
      STATUS.UNKNOWN,
      entries
        .filter((e) => e.unreadable)
        .map((e) => e.id)
        .join(', '),
    )
  report.add(
    'Missing expected',
    registry.missing.length
      ? registryComplete
        ? STATUS.FAIL
        : STATUS.UNKNOWN
      : registryComplete
        ? STATUS.OK
        : STATUS.UNKNOWN,
    registry.missing.length
      ? `${registry.missing.join(', ')}${registryComplete ? '' : ' (may be in an unreadable slot)'}`
      : absentValue([]),
  )
  report.add(
    'Expected but retired',
    absent(registry.retiredExpected.length > 0),
    absentValue(registry.retiredExpected),
  )
  report.add(
    'Duplicate active names',
    absent(registry.duplicateActiveNames.length > 0),
    absentValue(registry.duplicateActiveNames),
    registry.duplicateActiveNames.length ? 'the app uses the last active entry for a name' : '',
  )
  report.add(
    'Duplicate active addresses',
    registry.duplicateActiveAddresses.length ? STATUS.WARN : registryComplete ? STATUS.OK : STATUS.UNKNOWN,
    registry.duplicateActiveAddresses.length ? registry.duplicateActiveAddresses.join('; ') : absentValue([]),
  )
  report.add(
    'Active zero addresses',
    absent(registry.zeroAddress.length > 0),
    absentValue(registry.zeroAddress),
  )
  report.add(
    'Active without code',
    registry.noCode.length
      ? STATUS.FAIL
      : registry.unknownCode.length || !registryComplete
        ? STATUS.UNKNOWN
        : STATUS.OK,
    registry.noCode.length
      ? registry.noCode.join(', ')
      : registry.unknownCode.length
        ? `unreadable: ${registry.unknownCode.join(', ')}`
        : '0',
  )
  if (registry.unexpected.length)
    report.add(
      'Unexpected names',
      STATUS.WARN,
      registry.unexpected.join(', '),
      'not created by the snapshot deploy scripts',
    )
  if (registry.testOnlyOnMainnet.length)
    report.add('Test-only on mainnet', STATUS.WARN, registry.testOnlyOnMainnet.join(', '))
  for (const entry of entries) {
    report.info(
      `#${entry.id} ${entry.name}`,
      `${short(entry.address)}${entry.retired ? ' · retired' : ''}${entry.hasCode === false && !isZero(entry.address) ? ' · NO CODE' : ''}`,
    )
  }
  const lab = (name) => registry.resolved[name]?.address

  // ---- RENDERERS
  report.section('RENDERERS')
  const rendererNames = []
  let rendererUnreadable = 0
  if (renderers.ok) {
    for (let i = 0; i < Number(renderers.value) && i < 64; i++) {
      const info = await P('function rendererInfo(uint256) view returns (address renderer,string name_)', [
        BigInt(i),
      ])
      if (!info.ok) {
        rendererUnreadable++
        report.add(`Renderer #${i}`, STATUS.UNKNOWN, 'unreadable')
        continue
      }
      const [address, rawName] = Array.isArray(info.value)
        ? info.value
        : [info.value.renderer, info.value.name_]
      const name = boundString(rawName, 48)
      rendererNames.push(name)
      const builtin = i === 0 && isZero(address)
      const code = builtin ? true : await hasCode(address)
      report.add(
        `Renderer #${i} ${name}`,
        builtin ? STATUS.OK : codeStatus(code),
        builtin ? 'built-in (core)' : `${short(address)}${code === false ? ' · NO CODE' : ''}`,
      )
    }
  }
  const readiness = rendererReadiness({
    names: rendererNames,
    frozen: rFrozen.ok && rFrozen.value,
    unreadable: rendererUnreadable,
  })
  const rendererStatus = !renderers.ok ? STATUS.UNKNOWN : readiness.status
  const rendererValue = !renderers.ok
    ? 'unreadable'
    : readiness.complete
      ? 'COMPLETE'
      : `missing ${readiness.missing.join(', ')}${readiness.unreadable ? ` (${readiness.unreadable} unreadable)` : ''}`
  report.add('Expected renderers', rendererStatus, rendererValue)

  // ---- OWNERSHIP
  report.section('OWNERSHIP')
  const labsAddress = addr(await read(lab('flipbook') ?? ZERO, 'function LABS() view returns (address)'))
  const questsAddress = lab('quests')
  const ownables = [
    ['Paint', paint],
    ['Labs', labsAddress],
    ['Painter Pass', passAddress],
    ['Quests', questsAddress],
  ]
  const owners = []
  for (const [label, address] of ownables) {
    if (!address) {
      report.add(`${label} owner`, STATUS.UNKNOWN, 'address unknown')
      continue
    }
    const [o, p] = await Promise.all([
      read(address, 'function owner() view returns (address)'),
      read(address, 'function pendingOwner() view returns (address)'),
    ])
    const result = ownershipCheck({ owner: addr(o), pendingOwner: addr(p), expected: expectedOwner })
    if (addr(o)) owners.push(addr(o))
    report.add(`${label} owner`, result.status, result.value, result.detail)
  }
  if (!expectedOwner && owners.length > 1 && new Set(owners.map((o) => o.toLowerCase())).size > 1) {
    report.add(
      'Owners consistent',
      STATUS.WARN,
      'owners differ',
      'pass --expected-owner to compare against the project wallet',
    )
  }

  // ---- WIRING
  report.section('WIRING')
  const link = async (label, address, fragment, expected, severity = STATUS.FAIL) => {
    if (!address) return report.add(label, STATUS.UNKNOWN, 'contract not found')
    if (!expected) return report.add(label, STATUS.UNKNOWN, 'expected address unknown')
    const result = await read(address, fragment)
    if (!result.ok) return report.add(label, STATUS.UNKNOWN, 'unreadable')
    report.add(
      label,
      sameAddress(result.value, expected) ? STATUS.OK : severity,
      sameAddress(result.value, expected) ? 'match' : `${short(result.value)} ≠ ${short(expected)}`,
    )
  }
  await link('Labs → Paint', labsAddress, 'function CORE() view returns (address)', paint)
  await link('Pass → Paint', passAddress, 'function PAINT() view returns (address)', paint)
  await link('Quests → Paint', questsAddress, 'function PAINT() view returns (address)', paint)
  if (labsAddress) {
    const [lr, lb] = await Promise.all([
      read(labsAddress, 'function ROYALTY_RECEIVER() view returns (address)'),
      read(labsAddress, 'function ROYALTY_BPS() view returns (uint96)'),
    ])
    report.add(
      'Royalty (Labs)',
      lr.ok && lb.ok
        ? expectedOwner && !sameAddress(lr.value, expectedOwner)
          ? STATUS.WARN
          : STATUS.OK
        : STATUS.UNKNOWN,
      lr.ok && lb.ok ? `${short(lr.value)} · ${Number(lb.value) / 100}%` : 'unreadable',
    )
  }
  for (const name of ['flipbook', 'forks', 'sleepwalker', 'cd-burner', 'block-camera']) {
    if (!lab(name)) continue
    await link(`${name} → Paint`, lab(name), 'function PAINT() view returns (address)', paint)
    await link(`${name} → Labs`, lab(name), 'function LABS() view returns (address)', labsAddress)
  }
  for (const name of ['weeds', 'brushes', 'finale auction'])
    if (lab(name)) await link(`${name} → Paint`, lab(name), 'function PAINT() view returns (address)', paint)
  if (lab('recycle-bin'))
    await link('recycle-bin → Paint', lab('recycle-bin'), 'function CORE() view returns (address)', paint)
  for (const name of BOUND_EXPERIMENTS) {
    const entry = registry.resolved[name]
    if (!entry) continue
    const bound = await read(entry.address, 'function experimentId() view returns (uint256)')
    if (!bound.ok) report.add(`${name} experiment id`, STATUS.UNKNOWN, 'unreadable')
    else if (BigInt(bound.value) === UINT256_MAX)
      report.add(`${name} experiment id`, STATUS.FAIL, 'not bound', 'bindExperimentId was never called')
    else
      report.add(
        `${name} experiment id`,
        BigInt(bound.value) === BigInt(entry.id) ? STATUS.OK : STATUS.FAIL,
        BigInt(bound.value) === BigInt(entry.id)
          ? `#${entry.id}`
          : `bound #${bound.value} ≠ registry #${entry.id}`,
      )
  }

  // ---- PASS
  report.section('PASS')
  if (passAddress) {
    const passCode = await hasCode(passAddress)
    report.add('Pass contract', codeStatus(passCode), short(passAddress))
    const sourceCount = await read(passAddress, 'function stampSourceCount() view returns (uint256)')
    if (sourceCount.ok) {
      const n = Number(sourceCount.value)
      const sources = []
      for (let i = 0; i < n && i < 64; i++) {
        const [s, e] = await Promise.all([
          read(passAddress, 'function stampSource(uint256) view returns (address)', [BigInt(i)]),
          read(passAddress, 'function stampSourceEnabled(uint256) view returns (bool)', [BigInt(i)]),
        ])
        sources.push({ index: i, address: addr(s), enabled: e.ok ? Boolean(e.value) : undefined })
      }
      const nameOf = (address) =>
        Object.entries(registry.resolved).find(([, entry]) => sameAddress(entry.address, address))?.[0]
      const order = sources.map((source) => nameOf(source.address) ?? short(source.address))
      for (const source of sources) {
        const name = nameOf(source.address)
        const pin = PASS_BUILTIN_PINS + source.index
        report.add(
          `Source #${source.index} (pin ${pin})`,
          source.address === undefined || source.enabled === undefined
            ? STATUS.UNKNOWN
            : source.enabled
              ? STATUS.OK
              : STATUS.WARN,
          `${name ?? short(source.address)}${source.enabled === false ? ' · disabled' : ''}${pin >= PASS_MAX_PINS ? ' · metadata only' : ''}`,
        )
      }
      const expectedOrder = EXPECTED_STAMP_SOURCES.filter((name) => registry.resolved[name])
      const orderOk = expectedOrder.every((name, index) => order[index] === name)
      const orderUnknown = !orderOk && sources.some((source) => source.address === undefined)
      report.add(
        'Source order',
        orderOk ? STATUS.OK : orderUnknown ? STATUS.UNKNOWN : STATUS.WARN,
        orderOk ? 'matches deploy order' : order.join(', '),
        orderOk ? '' : `expected ${expectedOrder.join(', ')}`,
      )
      const capacity = passCapacity({ sourceCount: n })
      report.add('Built-in pins', STATUS.OK, String(capacity.builtin))
      report.add('External sources', STATUS.OK, String(capacity.sources))
      report.add('Visual pins used', STATUS.OK, `${capacity.used} / ${capacity.maxPins}`)
      report.add(
        'Visual pins remaining',
        capacity.remaining >= PASS_RESERVED_PINS ? STATUS.OK : STATUS.WARN,
        String(capacity.remaining),
        capacity.remaining >= PASS_RESERVED_PINS
          ? `last ${PASS_RESERVED_PINS} reserved by policy`
          : 'reserved pins consumed; needs an explicit design decision',
      )
      if (capacity.metadataOnly)
        report.add('Metadata-only sources', STATUS.WARN, String(capacity.metadataOnly))
    } else report.add('Stamp sources', STATUS.UNKNOWN, 'unreadable')
  } else report.add('Pass contract', STATUS.UNKNOWN, 'address unknown')

  // ---- QUESTS
  report.section('QUESTS')
  const cardDrv = lab('card-drv')
  const monadCardRes = cardDrv
    ? await read(cardDrv, 'function MONAD_CARD() view returns (address)')
    : { ok: false }
  const monadCard = addr(monadCardRes)
  if (questsAddress) {
    const qc = await read(questsAddress, 'function questCount() view returns (uint256)')
    report.add('Quest count', qc.ok ? STATUS.OK : STATUS.UNKNOWN, qc.ok ? String(qc.value) : 'unreadable')
    if (qc.ok) {
      let carrier
      let questsUnreadable = 0
      for (let i = 0; i < Number(qc.value) && i < 64; i++) {
        const q = await read(
          questsAddress,
          'function questInfo(uint256) view returns (string name,uint48 startBlock,uint48 endBlock,(address target,bytes4 selector,uint8 word,uint8 op,uint256 threshold)[] conditions)',
          [BigInt(i)],
        )
        if (!q.ok) {
          questsUnreadable++
          continue
        }
        const [name, , , conditions] = Array.isArray(q.value)
          ? q.value
          : [q.value.name, 0, 0, q.value.conditions]
        if (name === 'CARD CARRIER') carrier = { id: i, conditions }
      }
      if (!carrier && questsUnreadable)
        report.add('CARD CARRIER', STATUS.UNKNOWN, 'not found', `${questsUnreadable} quest(s) unreadable`)
      else if (!carrier)
        report.add(
          'CARD CARRIER',
          cardDrv ? STATUS.FAIL : STATUS.WARN,
          'not found',
          cardDrv ? 'DeployMonadCard adds it' : 'CARD.DRV not deployed yet',
        )
      else if (!monadCard)
        report.add(
          'CARD CARRIER',
          STATUS.UNKNOWN,
          `quest #${carrier.id}`,
          'card address unknown, conditions not compared',
        )
      else {
        const ok = questMatchesCardCarrier({ conditions: carrier.conditions }, { monadCard, paint })
        report.add(
          'CARD CARRIER',
          ok ? STATUS.OK : STATUS.FAIL,
          ok ? `quest #${carrier.id} · card ≥ 1 and 143 px` : `quest #${carrier.id} conditions differ`,
        )
      }
    }
  } else report.add('Quests', STATUS.UNKNOWN, 'not in registry')

  // ---- CARD.DRV
  report.section('CARD.DRV')
  if (!cardDrv) report.add('CARD.DRV', STATUS.FAIL, 'not registered')
  else {
    const [fmt, busWord, busWords] = await Promise.all([
      read(cardDrv, 'function FORMAT_VERSION() view returns (uint256)'),
      read(cardDrv, 'function BUS_WORD() view returns (uint256)'),
      read(cardDrv, 'function BUS_WORDS() view returns (uint256)'),
    ])
    if (!monadCard) report.add('Monad Card', STATUS.UNKNOWN, 'unreadable')
    else if (!chainKnown) report.add('Monad Card', STATUS.UNKNOWN, short(monadCard), 'actual chain unknown')
    else if (chainId === 143)
      report.add(
        'Monad Card',
        sameAddress(monadCard, OFFICIAL.monadCard) ? STATUS.OK : STATUS.FAIL,
        sameAddress(monadCard, OFFICIAL.monadCard)
          ? `official ${short(monadCard)}`
          : `${short(monadCard)} is not the official card`,
      )
    else {
      const cardCode = await hasCode(monadCard)
      report.add(
        'Monad Card',
        sameAddress(monadCard, OFFICIAL.monadCard) ? STATUS.WARN : codeStatus(cardCode),
        sameAddress(monadCard, OFFICIAL.monadCard)
          ? 'official address off-mainnet'
          : `mock ${short(monadCard)} (off-mainnet)`,
      )
    }
    report.add(
      'Format version',
      fmt.ok ? (Number(fmt.value) === 1 ? STATUS.OK : STATUS.WARN) : STATUS.UNKNOWN,
      fmt.ok ? String(fmt.value) : 'unreadable',
    )
    const busOk = busWord.ok && busWords.ok && Number(busWord.value) === 24 && Number(busWords.value) === 4
    report.add(
      'CARD BUS W24–W27',
      busWord.ok && busWords.ok ? (busOk ? STATUS.OK : STATUS.WARN) : STATUS.UNKNOWN,
      'RESERVED BY SPEC',
      'no current feature consumes these words',
    )
  }

  // ---- MONAD HARDWARE
  report.section('MONAD HARDWARE')
  for (const name of ['page-exe', 'block-camera', 'kernel-debugger']) {
    const entry = registry.resolved[name]
    report.add(
      name,
      entry ? codeStatus(entry.hasCode) : STATUS.FAIL,
      entry ? short(entry.address) : 'not registered',
    )
  }
  const camera = lab('block-camera')
  if (camera)
    await link('Block Camera → CARD_MEMORY', camera, 'function CARD_MEMORY() view returns (address)', cardDrv)
  const probe = async (label, to, data, interpret) => {
    const result = await safe(() => reader.call(to, data))
    if (!result.ok)
      return report.add(
        label,
        live ? STATUS.WARN : STATUS.UNKNOWN,
        'call failed',
        'presence probe only; semantics need testnet',
      )
    const verdict = interpret(result.value)
    report.add(
      label,
      verdict ? STATUS.OK : live ? STATUS.WARN : STATUS.UNKNOWN,
      verdict ? 'responds' : 'no meaningful response',
      'presence probe only; semantics need testnet',
    )
  }
  await probe(
    'Staking device 0x1000',
    MONAD_DEVICES.staking,
    '0x757991a8',
    (data) => typeof data === 'string' && data.length >= 2 + 128,
  ) // getEpoch()
  await probe(
    'Reserve device 0x1001',
    MONAD_DEVICES.reserve,
    '0x3a61584e',
    (data) => typeof data === 'string' && data.length >= 66,
  )
  await probe(
    'P256 0x0100',
    MONAD_DEVICES.p256,
    P256_VECTOR,
    (data) => typeof data === 'string' && /^0x0{63}1$/.test(data),
  )
  report.add(
    'History code',
    historyCode === true
      ? STATUS.OK
      : historyCode == null
        ? STATUS.UNKNOWN
        : live
          ? STATUS.FAIL
          : STATUS.WARN,
    historyCode === true ? 'present' : 'absent',
  )

  // ---- OPERATOR
  report.section('OPERATOR')
  const operator = lab('operator-record')
  if (!operator) report.add('Operator Record', STATUS.FAIL, 'not registered')
  else {
    const [subsystems, identity] = await Promise.all([
      read(operator, 'function SUBSYSTEM_COUNT() view returns (uint256)'),
      read(operator, 'function IDENTITY_MASK() view returns (uint256)'),
    ])
    const abiOk =
      subsystems.ok && identity.ok && Number(subsystems.value) === 16 && BigInt(identity.value) === 1n << 15n
    report.add(
      'Subsystem ABI',
      subsystems.ok && identity.ok ? (abiOk ? STATUS.OK : STATUS.FAIL) : STATUS.UNKNOWN,
      abiOk ? 'v1 · 16 · identity bit 15' : subsystems.ok ? `${subsystems.value} subsystems` : 'unreadable',
      'v1 is fixed; extensions get their own contract',
    )
    const targets = { 'core:paint': paint, 'core:pass': passAddress, 'card:monad-card': monadCard }
    const tally = { matched: 0, mismatched: 0, unresolved: 0 }
    for (const source of OPERATOR_SOURCES) {
      const expected = targets[source.target] ?? lab(source.target)
      const actual = await read(operator, `function ${source.fn}() view returns (address)`)
      if (!actual.ok || !expected) {
        tally.unresolved++
        report.add(
          `→ ${source.fn}`,
          STATUS.UNKNOWN,
          actual.ok ? `${short(actual.value)} · registry entry missing` : 'unreadable',
        )
        continue
      }
      const match = sameAddress(actual.value, expected)
      if (match) tally.matched++
      else tally.mismatched++
      report.add(
        `→ ${source.fn}`,
        match ? STATUS.OK : STATUS.FAIL,
        match ? 'MATCH' : `record ${short(actual.value)} · live ${short(expected)}`,
      )
    }
    const aggregate = aggregateMatches(tally)
    report.add('Sources', aggregate.status, aggregate.value)
  }

  // ---- SYSTEM EVENT
  report.section('SYSTEM EVENT')
  const event = lab('system-event')
  if (!event) report.add('System Event', STATUS.FAIL, 'not registered')
  else {
    const E = (fragment) => read(event, fragment)
    const [feed, threshold, maxAge, activated, activatedBlock, activationAnswer, decimals, condition] =
      await Promise.all([
        E('function FEED() view returns (address)'),
        E('function THRESHOLD_MILLI_USD() view returns (uint256)'),
        E('function MAX_AGE() view returns (uint256)'),
        E('function activated() view returns (bool)'),
        E('function activatedBlock() view returns (uint48)'),
        E('function activationAnswer() view returns (int256)'),
        E('function FEED_DECIMALS() view returns (uint8)'),
        E(
          'function condition() view returns (bool met,bool fresh,int256 answer,uint256 updatedAt,uint80 roundId)',
        ),
      ])
    const feedAddress = addr(feed)
    if (!feedAddress) report.add('Feed', STATUS.UNKNOWN, 'unreadable')
    else if (!chainKnown) report.add('Feed', STATUS.UNKNOWN, short(feedAddress), 'actual chain unknown')
    else if (chainId === 143)
      report.add(
        'Feed',
        sameAddress(feedAddress, OFFICIAL.monUsdFeed) ? STATUS.OK : STATUS.FAIL,
        sameAddress(feedAddress, OFFICIAL.monUsdFeed)
          ? `official ${short(feedAddress)}`
          : `${short(feedAddress)} is not the verified MON/USD proxy`,
      )
    else report.add('Feed', STATUS.OK, `${short(feedAddress)} (off-mainnet)`)
    if (feedAddress) {
      const [code, description, feedDecimals] = await Promise.all([
        hasCode(feedAddress),
        read(feedAddress, 'function description() view returns (string)'),
        read(feedAddress, 'function decimals() view returns (uint8)'),
      ])
      report.add('Feed code', codeStatus(code), code ? 'present' : code === false ? 'NO CODE' : 'unreadable')
      report.add(
        'Feed description',
        description.ok ? STATUS.OK : STATUS.UNKNOWN,
        description.ok ? boundString(description.value, 40) : 'unreadable',
      )
      const decimalsMatch =
        feedDecimals.ok && decimals.ok && Number(feedDecimals.value) === Number(decimals.value)
      report.add(
        'Feed decimals',
        feedDecimals.ok && decimals.ok ? (decimalsMatch ? STATUS.OK : STATUS.FAIL) : STATUS.UNKNOWN,
        feedDecimals.ok
          ? `${feedDecimals.value}${decimals.ok ? ` · event expects ${decimals.value}` : ''}`
          : 'unreadable',
      )
    }
    report.add(
      'Threshold',
      threshold.ok ? STATUS.OK : STATUS.UNKNOWN,
      threshold.ok ? `$${(Number(threshold.value) / 1000).toFixed(3)}` : 'unreadable',
    )
    report.add(
      'Max age',
      maxAge.ok ? STATUS.OK : STATUS.UNKNOWN,
      maxAge.ok ? `${maxAge.value}s` : 'unreadable',
    )
    if (condition.ok) {
      const [met, fresh, answer, updatedAt] = Array.isArray(condition.value)
        ? condition.value
        : [condition.value.met, condition.value.fresh, condition.value.answer, condition.value.updatedAt]
      const age = block ? Number(block.timestamp) - Number(updatedAt) : undefined
      const answerText = decimals.ok
        ? `$${(Number(answer) / 10 ** Number(decimals.value)).toFixed(5)}`
        : String(answer)
      report.add(
        'Latest round',
        fresh ? STATUS.OK : STATUS.WARN,
        `${answerText}${age != null ? ` · ${age}s old` : ''}`,
        fresh ? '' : 'stale relative to MAX_AGE',
      )
      const state =
        activated.ok && activated.value
          ? `ACTIVATED at block ${activatedBlock.ok ? activatedBlock.value : '?'}`
          : met
            ? 'CONDITION MET (not activated)'
            : 'ARMED'
      report.add(
        'State',
        activated.ok ? STATUS.OK : STATUS.UNKNOWN,
        state,
        activated.ok && activated.value && activationAnswer.ok
          ? `activation answer ${activationAnswer.value}`
          : 'this tool never calls activate()',
      )
    } else report.add('Latest round', STATUS.UNKNOWN, 'unreadable')
  }

  // ---- ROUTER
  report.section('ROUTER')
  const router = lab('router-lab')
  if (!router) report.add('router-lab', STATUS.FAIL, 'not registered')
  else {
    const [iface, maxVenues, minGas, maxGas] = await Promise.all([
      read(router, 'function INTERFACE() view returns (string)'),
      read(router, 'function MAX_VENUES() view returns (uint256)'),
      read(router, 'function MIN_GAS_PER_FRAME() view returns (uint256)'),
      read(router, 'function MAX_GAS_PER_FRAME() view returns (uint256)'),
    ])
    const revision = mrcRevision ? mrcRevision.slice(0, 8) : undefined
    const ifaceText = iface.ok ? boundString(iface.value, 60) : ''
    report.add(
      'MRC revision',
      !iface.ok || !revision ? STATUS.UNKNOWN : ifaceText.includes(revision) ? STATUS.OK : STATUS.WARN,
      iface.ok ? ifaceText : 'unreadable',
      revision && iface.ok && !ifaceText.includes(revision) ? `app pins ${revision}` : '',
    )
    report.add(
      'Limits',
      maxVenues.ok && minGas.ok && maxGas.ok ? STATUS.OK : STATUS.UNKNOWN,
      maxVenues.ok ? `${maxVenues.value} venues · ${minGas.value}–${maxGas.value} gas/frame` : 'unreadable',
    )
    if (!chainKnown) {
      report.add('Adapters', STATUS.UNKNOWN, 'actual chain unknown; adapter rules not applied')
    } else if (chainId === 143) {
      const counts = { MATCH: 0, DIFFERS: 0, 'NO CODE': 0, UNKNOWN: 0 }
      for (const venue of venues) {
        const code = await safe(() => reader.code(venue.adapter))
        const present = code.ok ? Boolean(code.value && code.value !== '0x') : undefined
        const hash = present ? await safe(() => reader.codeHash(venue.adapter)) : { ok: false }
        const state = codeHashState({
          hasCode: present,
          codeHash: hash.ok ? hash.value : undefined,
          expected: venue.expectedCodeHash,
        })
        counts[state]++
        report.add(
          venue.label,
          state === 'MATCH' ? STATUS.OK : state === 'UNKNOWN' ? STATUS.UNKNOWN : STATUS.WARN,
          `${short(venue.adapter)} · ${state}`,
        )
      }
      report.add(
        'Configured adapters',
        venues.length ? STATUS.OK : STATUS.UNKNOWN,
        venues.length ? String(venues.length) : 'manifest not loaded',
      )
      const bad = counts.DIFFERS + counts['NO CODE']
      report.add(
        'Code hash mismatches',
        bad ? STATUS.WARN : counts.UNKNOWN || !venues.length ? STATUS.UNKNOWN : STATUS.OK,
        `${bad}${counts.UNKNOWN ? ` · ${counts.UNKNOWN} unknown` : ''}`,
      )
    } else {
      const directory = lab('router-mock-venues')
      report.add(
        'Mock venue directory',
        directory ? STATUS.OK : STATUS.WARN,
        directory ? short(directory) : 'not registered',
        'off-mainnet ROUTER.EXE reads mocks from here',
      )
    }
  }

  // ---- RELEASES
  report.section('RELEASES')
  if (!releases) report.add('releases.json', STATUS.UNKNOWN, 'not read')
  else {
    const result = validateReleases(releases, knownProgramIds, now)
    if (!result.rows.length) report.add('Scheduled programs', STATUS.OK, 'none')
    for (const row of result.rows) report.add(row.id, row.status, row.value)
    report.info('Reveal-all', 'VITE_REVEAL_ALL=true (or dev mode) shows every program: testnet only')
  }

  // ---- FREEZE READINESS
  report.section('FREEZE READINESS')
  report.add(
    'Renderers state',
    rFrozen.ok ? (rFrozen.value ? STATUS.OK : STATUS.WARN) : STATUS.UNKNOWN,
    rFrozen.ok ? (rFrozen.value ? 'FROZEN' : 'NOT FROZEN') : 'unreadable',
    rFrozen.ok && !rFrozen.value ? 'decision: REVIEW BEFORE MAINNET (freeze only after verification)' : '',
  )
  report.add('Renderers expected entries', rendererStatus, rendererValue)
  report.add(
    'Experiments state',
    eFrozen.ok ? (eFrozen.value ? STATUS.WARN : STATUS.OK) : STATUS.UNKNOWN,
    eFrozen.ok ? (eFrozen.value ? 'FROZEN' : 'NOT FROZEN · policy INTENTIONAL') : 'unreadable',
    eFrozen.ok
      ? eFrozen.value
        ? 'policy says leave open at launch; confirm this was a deliberate decision'
        : 'reason: future discovery headroom; owner can still append/retire entries'
      : '',
  )

  return finish(report, { chainId, chainName, block, expectedChain })
}

/** Valid secp256r1 vector (same as src/chain/monadHardware.ts). Returns 32-byte 1 when verified. */
export const P256_VECTOR =
  '0x84620b4976eefe556d558a13e176b421238988a31fef4ec774cfe5e5e7ad479fe0c14450794f14eb78eabf357b55e7ad08de3bb2e8eb2982a4856328dacf27707bc0d2c6db0305dde670ef690dd4e9bbee8f4e5ba831a0c678997e5b58ee1b0f471c3e758c4904285bba7e53118ed0f524adeb0757d25bd2f8e7b0d76dfa714cdd520f7aca8a8b917acc37f51de8f0c9bbe3ad858382e702dc25a12d09f7a858'

function finish(report, { chainId, chainName, block, expectedChain }) {
  const checks = allChecks(report)
  const summary = summarize(checks)
  return {
    chain: {
      id: chainId ?? null,
      name: chainName,
      expectedId: expectedChain ?? null,
      matchesExpected: expectedChain == null || chainId == null ? null : chainId === expectedChain,
    },
    block: block ? block.number : null,
    sections: report.sections,
    external: EXTERNAL_CHECKS,
    summary,
    exitCode: exitCodeFor(summary),
  }
}

// ---------------------------------------------------------------------------
// CLI argument handling (pure)
// ---------------------------------------------------------------------------

export function parseArgs(argv, env = {}) {
  const out = { json: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--json') out.json = true
    else if (arg === '--rpc') out.rpc = next()
    else if (arg === '--paint') out.paint = next()
    else if (arg === '--expected-owner') out.expectedOwner = next()
    else if (arg === '--expected-chain') out.expectedChainRaw = next() ?? ''
    else if (arg.startsWith('--expected-chain=')) out.expectedChainRaw = arg.slice(17)
    else if (arg.startsWith('--rpc=')) out.rpc = arg.slice(6)
    else if (arg.startsWith('--paint=')) out.paint = arg.slice(8)
    else if (arg.startsWith('--expected-owner=')) out.expectedOwner = arg.slice(17)
    // Only the flag NAME is ever echoed: `--rpc-url=https://…/KEY` must not print its value.
    else out.unknown = [...(out.unknown ?? []), arg.startsWith('--') ? arg.split('=')[0] : '(positional)']
  }
  out.rpc ??= env.RPC_URL
  out.paint ??= env.PAINT_ADDRESS
  out.expectedOwner ??= env.EXPECTED_OWNER
  // The CLI flag wins over EXPECTED_CHAIN_ID. Malformed values are usage errors, never coerced.
  const fromFlag = out.expectedChainRaw !== undefined
  if (!fromFlag) out.expectedChainRaw = env.EXPECTED_CHAIN_ID
  const raw = out.expectedChainRaw == null ? '' : String(out.expectedChainRaw).trim()
  if (raw === '') {
    if (fromFlag) out.errors = [...(out.errors ?? []), 'invalid --expected-chain: value missing']
  } else {
    const id = parseChainId(raw)
    if (id == null)
      out.errors = [...(out.errors ?? []), 'invalid --expected-chain: use a positive integer chain id']
    else out.expectedChain = id
  }
  delete out.expectedChainRaw
  return out
}

export const HELP = `r3tards launch doctor: read-only deployment verification

usage (preferred: keep key-bearing RPC URLs out of argv):
  RPC_URL="$MONAD_RPC_URL" node scripts/launch-doctor.mjs \
    --paint <address> \
    [--expected-owner <address>] \
    [--expected-chain <chainId>] \
    [--json]

--rpc <public-url> is also supported. env fallbacks: RPC_URL, PAINT_ADDRESS, EXPECTED_OWNER, EXPECTED_CHAIN_ID

--expected-chain is the chain you INTEND to inspect (143 mainnet, 10143 testnet). a different
actual chain is a FAIL; omitting it is a WARN. mainnet-only rules always follow the actual chain.

never signs, sends transactions or requests a wallet. the RPC URL is never printed.
exit code 1 when any check FAILs; WARN and UNKNOWN need manual review.`
