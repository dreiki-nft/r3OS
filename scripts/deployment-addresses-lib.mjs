const ADDRESS = /^0x[0-9a-fA-F]{40}$/

export const MAINNET_BROADCAST_FILES = Object.freeze([
  'Deploy.s.sol/143/run-latest.json',
  'DeployMonadCard.s.sol/143/run-latest.json',
  'DeployMonadHW.s.sol/143/run-latest.json',
  'DeployOperator.s.sol/143/run-latest.json',
  'DeployRouterLab.s.sol/143/run-latest.json',
])

export const MAINNET_JOURNAL_FILES = Object.freeze([
  'mainnet-core-broadcast-journal.json',
  'mainnet-core-recovery-journal.json',
  'mainnet-card-drv-broadcast-journal.json',
  'mainnet-card-drv-recovery-journal.json',
  'mainnet-monad-hw-broadcast-journal.json',
  'mainnet-operator-system-event-broadcast-journal.json',
  'mainnet-router-lab-broadcast-journal.json',
])

export const CONTRACT_ENV_KEYS = Object.freeze({
  R3OSPaint: 'PAINT_ADDRESS',
  R3OSLabs: 'LABS_ADDRESS',
  DiffRenderer: 'DIFF_RENDERER_ADDRESS',
  SeasonTimelapseRenderer: 'TIMELAPSE_RENDERER_ADDRESS',
  DF1Renderer: 'DF1_RENDERER_ADDRESS',
  R3OSPainterPass: 'PASS_ADDRESS',
  R3OSFinaleAuction: 'FINALE_AUCTION_ADDRESS',
  R3OSQuests: 'QUESTS_ADDRESS',
  R3OSRecycleBin: 'RECYCLE_BIN_ADDRESS',
  R3OSCDBurner: 'CD_BURNER_ADDRESS',
  R3OSCardMemory: 'CARD_MEMORY_ADDRESS',
  R3OSPageExe: 'PAGE_EXE_ADDRESS',
  R3OSBlockCamera: 'BLOCK_CAMERA_ADDRESS',
  R3OSOperatorRecord: 'OPERATOR_RECORD_ADDRESS',
  R3OSSystemEvent: 'SYSTEM_EVENT_ADDRESS',
  R3OSRouterLab: 'ROUTER_LAB_ADDRESS',
})

export const EXPECTED_MAINNET_CONTRACTS = Object.freeze(Object.keys(CONTRACT_ENV_KEYS))

export const CONTRACT_SOURCES = Object.freeze({
  R3OSPaint: 'src/R3OSPaint.sol:R3OSPaint',
  R3OSLabs: 'src/R3OSLabs.sol:R3OSLabs',
  DiffRenderer: 'src/renderers/DiffRenderer.sol:DiffRenderer',
  SeasonTimelapseRenderer: 'src/renderers/SeasonTimelapseRenderer.sol:SeasonTimelapseRenderer',
  DF1Renderer: 'src/renderers/DF1Renderer.sol:DF1Renderer',
  R3OSPainterPass: 'src/R3OSPainterPass.sol:R3OSPainterPass',
  R3OSFinaleAuction: 'src/labs/R3OSFinaleAuction.sol:R3OSFinaleAuction',
  R3OSQuests: 'src/labs/R3OSQuests.sol:R3OSQuests',
  R3OSRecycleBin: 'src/labs/R3OSRecycleBin.sol:R3OSRecycleBin',
  R3OSCDBurner: 'src/labs/R3OSCDBurner.sol:R3OSCDBurner',
  R3OSCardMemory: 'src/monadcard/R3OSCardMemory.sol:R3OSCardMemory',
  R3OSPageExe: 'src/monadhw/R3OSPageExe.sol:R3OSPageExe',
  R3OSBlockCamera: 'src/monadhw/R3OSBlockCamera.sol:R3OSBlockCamera',
  R3OSOperatorRecord: 'src/operator/R3OSOperatorRecord.sol:R3OSOperatorRecord',
  R3OSSystemEvent: 'src/operator/R3OSSystemEvent.sol:R3OSSystemEvent',
  R3OSRouterLab: 'src/router/R3OSRouterLab.sol:R3OSRouterLab',
})

function isAddress(value) {
  return ADDRESS.test(String(value ?? ''))
}

function normalizeAddress(value) {
  return String(value).toLowerCase()
}

function requireAddress(value, label) {
  if (!isAddress(value)) throw new Error(`${label}: invalid address`)
  return value
}

function entriesOf(journal) {
  return Array.isArray(journal?.entries) ? journal.entries : []
}

function successfulFinalized(entry) {
  return entry?.state === 'FINALIZED' && entry?.receipt?.status === '0x1'
}

function successfulCreateAddress(entry) {
  if (!successfulFinalized(entry)) return null
  const created = entry?.receipt?.contractAddress
  return isAddress(created) ? created : null
}

function assertFinalizedEntries(journal, count, sourceLabel) {
  const entries = entriesOf(journal)
  if (entries.length !== count) throw new Error(`${sourceLabel}: expected ${count} journal entries, found ${entries.length}`)
  for (let i = 0; i < entries.length; i++) {
    if (!successfulFinalized(entries[i])) throw new Error(`${sourceLabel}: entry ${i + 1} is not a successful FINALIZED transaction`)
  }
  return entries
}

function assertCreateMatches(entry, expected, label) {
  const actual = successfulCreateAddress(entry)
  if (!actual) throw new Error(`${label}: missing successful CREATE receipt`)
  if (normalizeAddress(actual) !== normalizeAddress(expected)) throw new Error(`${label}: CREATE receipt ${actual} != expected ${expected}`)
}

export function extractCreatedContracts(run, sourceLabel = 'broadcast') {
  const out = []
  for (const tx of Array.isArray(run?.transactions) ? run.transactions : []) {
    const contractName = tx?.contractName
    const contractAddress = tx?.contractAddress
    const txType = String(tx?.transactionType ?? '').toUpperCase()
    if (!contractName || !contractAddress) continue
    if (!['CREATE', 'CREATE2'].includes(txType)) continue
    if (!isAddress(contractAddress)) throw new Error(`${sourceLabel}: invalid ${contractName} contractAddress`)
    if (!(contractName in CONTRACT_ENV_KEYS)) continue
    out.push({ contractName, address: contractAddress, source: sourceLabel })
  }
  return out
}

export function extractJournalContracts(journal, sourceLabel = 'journal') {
  const schema = String(journal?.schema ?? '')
  if (schema === 'r3os-card-drv-broadcast/v1') {
    const cardMemory = requireAddress(journal.cardMemory, `${sourceLabel}: cardMemory`)
    const entries = entriesOf(journal)
    if (journal.state === 'COMPLETE') assertFinalizedEntries(journal, 4, sourceLabel)
    else {
      if (entries.length !== 2 || !entries.every(successfulFinalized)) {
        throw new Error(`${sourceLabel}: incomplete CARD.DRV incident journal is not the reviewed 2-finalized-entry shape`)
      }
    }
    assertCreateMatches(entries[0], cardMemory, `${sourceLabel}: R3OSCardMemory`)
    return [{ contractName: 'R3OSCardMemory', address: cardMemory, source: sourceLabel, evidenceKind: 'guarded-journal' }]
  }

  if (schema === 'r3os-monad-hardware-broadcast/v1') {
    const pageExe = requireAddress(journal.pageExe, `${sourceLabel}: pageExe`)
    const blockCamera = requireAddress(journal.blockCamera, `${sourceLabel}: blockCamera`)
    const entries = assertFinalizedEntries(journal, 5, sourceLabel)
    assertCreateMatches(entries[0], pageExe, `${sourceLabel}: R3OSPageExe`)
    assertCreateMatches(entries[1], blockCamera, `${sourceLabel}: R3OSBlockCamera`)
    return [
      { contractName: 'R3OSPageExe', address: pageExe, source: sourceLabel, evidenceKind: 'guarded-journal' },
      { contractName: 'R3OSBlockCamera', address: blockCamera, source: sourceLabel, evidenceKind: 'guarded-journal' },
    ]
  }

  if (schema === 'r3os-operator-system-event-broadcast/v1') {
    const operatorRecord = requireAddress(journal.operatorRecord, `${sourceLabel}: operatorRecord`)
    const systemEvent = requireAddress(journal.systemEvent, `${sourceLabel}: systemEvent`)
    const entries = assertFinalizedEntries(journal, 4, sourceLabel)
    if (journal.state !== 'COMPLETE') throw new Error(`${sourceLabel}: Operator/System Event journal is not COMPLETE`)
    assertCreateMatches(entries[0], operatorRecord, `${sourceLabel}: R3OSOperatorRecord`)
    assertCreateMatches(entries[1], systemEvent, `${sourceLabel}: R3OSSystemEvent`)
    return [
      { contractName: 'R3OSOperatorRecord', address: operatorRecord, source: sourceLabel, evidenceKind: 'guarded-journal' },
      { contractName: 'R3OSSystemEvent', address: systemEvent, source: sourceLabel, evidenceKind: 'guarded-journal' },
    ]
  }

  if (schema === 'r3os-router-lab-broadcast/v1') {
    const routerLab = requireAddress(journal.routerLab, `${sourceLabel}: routerLab`)
    const entries = assertFinalizedEntries(journal, 2, sourceLabel)
    if (journal.state !== 'COMPLETE') throw new Error(`${sourceLabel}: Router Lab journal is not COMPLETE`)
    assertCreateMatches(entries[0], routerLab, `${sourceLabel}: R3OSRouterLab`)
    return [{ contractName: 'R3OSRouterLab', address: routerLab, source: sourceLabel, evidenceKind: 'guarded-journal' }]
  }

  if (
    schema === 'r3os-core-manual-broadcast/v1' ||
    schema === 'r3os-core-recovery-broadcast/v1' ||
    schema === 'r3os-card-drv-recovery/v1'
  ) return []

  throw new Error(`${sourceLabel}: unsupported deployment journal schema ${schema || '<missing>'}`)
}

export function mergeContractEvidence(items) {
  const byName = new Map()
  for (const item of items) {
    const normalizedItem = item.evidenceKind ? item : { ...item, evidenceKind: 'foundry-artifact' }
    const prior = byName.get(item.contractName)
    if (prior && normalizeAddress(prior.address) !== normalizeAddress(item.address)) {
      throw new Error(`conflicting ${item.contractName} addresses: ${prior.address} vs ${item.address}`)
    }
    if (!prior || prior.evidenceKind === 'foundry-artifact') byName.set(item.contractName, normalizedItem)
  }
  const missing = EXPECTED_MAINNET_CONTRACTS.filter((name) => !byName.has(name))
  const contracts = Object.fromEntries(
    EXPECTED_MAINNET_CONTRACTS.filter((name) => byName.has(name)).map((name) => [name, byName.get(name).address]),
  )
  const evidence = Object.fromEntries(
    EXPECTED_MAINNET_CONTRACTS.filter((name) => byName.has(name)).map((name) => [name, byName.get(name)]),
  )
  return { contracts, evidence, missing, complete: missing.length === 0 }
}

export function mergeDeploymentRuns(runs) {
  return mergeContractEvidence(runs.flatMap(({ run, source }) => extractCreatedContracts(run, source)))
}

function journalBySchema(journals, schema) {
  return journals.find(({ journal }) => journal?.schema === schema)
}

function isCoreIncident(journal) {
  const entries = entriesOf(journal)
  if (entries.length !== 7) return false
  return entries.slice(0, 6).every(successfulFinalized) && entries[6]?.state === 'REVERTED' && entries[6]?.receipt?.status === '0x0'
}

function isCoreDirectComplete(journal) {
  if (journal?.state !== 'COMPLETE') return false
  const entries = entriesOf(journal)
  return entries.length === 29 && entries.every(successfulFinalized)
}

function isCompleteFinalizedJournal(journal, count) {
  return journal?.state === 'COMPLETE' && entriesOf(journal).length === count && entriesOf(journal).every(successfulFinalized)
}

function isCardIncident(journal) {
  return journal?.schema === 'r3os-card-drv-broadcast/v1' && journal?.state !== 'COMPLETE' && entriesOf(journal).length === 2 && entriesOf(journal).every(successfulFinalized)
}

export function assessDeploymentStages(journals) {
  const stages = {}

  const core = journalBySchema(journals, 'r3os-core-manual-broadcast/v1')?.journal
  const coreRecovery = journalBySchema(journals, 'r3os-core-recovery-broadcast/v1')?.journal
  if (isCoreDirectComplete(core)) stages.core = { ok: true, mode: 'direct' }
  else if (isCoreIncident(core) && isCompleteFinalizedJournal(coreRecovery, 22)) stages.core = { ok: true, mode: 'recovered' }
  else stages.core = { ok: false, reason: 'missing complete CORE evidence (direct 29/29 or reviewed incident+22-tx recovery)' }

  const card = journalBySchema(journals, 'r3os-card-drv-broadcast/v1')?.journal
  const cardRecovery = journalBySchema(journals, 'r3os-card-drv-recovery/v1')?.journal
  if (isCompleteFinalizedJournal(card, 4)) stages.cardDrv = { ok: true, mode: 'direct' }
  else if (isCardIncident(card) && isCompleteFinalizedJournal(cardRecovery, 2)) stages.cardDrv = { ok: true, mode: 'recovered' }
  else stages.cardDrv = { ok: false, reason: 'missing complete CARD.DRV evidence (direct 4/4 or reviewed 2+2 recovery)' }

  const hardware = journalBySchema(journals, 'r3os-monad-hardware-broadcast/v1')?.journal
  const hardwareEntriesFinalized = entriesOf(hardware).length === 5 && entriesOf(hardware).every(successfulFinalized)
  stages.monadHardware = hardwareEntriesFinalized
    ? { ok: true, mode: hardware?.state === 'COMPLETE' ? 'complete' : 'finalized-postcheck-abort' }
    : { ok: false, reason: 'missing five finalized Monad Hardware transactions' }

  const operator = journalBySchema(journals, 'r3os-operator-system-event-broadcast/v1')?.journal
  stages.operatorSystemEvent = isCompleteFinalizedJournal(operator, 4)
    ? { ok: true, mode: 'complete' }
    : { ok: false, reason: 'missing complete Operator/System Event 4/4 evidence' }

  const router = journalBySchema(journals, 'r3os-router-lab-broadcast/v1')?.journal
  stages.routerLab = isCompleteFinalizedJournal(router, 2)
    ? { ok: true, mode: 'complete' }
    : { ok: false, reason: 'missing complete Router Lab 2/2 evidence' }

  const complete = Object.values(stages).every((stage) => stage.ok)
  return { complete, stages }
}

export function finalizedCreateReceiptAddresses(journals) {
  const addresses = new Set()
  for (const { journal } of journals) {
    for (const entry of entriesOf(journal)) {
      const created = successfulCreateAddress(entry)
      if (created) addresses.add(normalizeAddress(created))
    }
  }
  return addresses
}

export function verifyFoundryCreatesAgainstJournals(run, journals, sourceLabel = 'Deploy.s.sol/143/run-latest.json') {
  const created = extractCreatedContracts(run, sourceLabel)
  const receiptAddresses = finalizedCreateReceiptAddresses(journals)
  for (const item of created) {
    if (!receiptAddresses.has(normalizeAddress(item.address))) {
      throw new Error(`${sourceLabel}: ${item.contractName} ${item.address} has no matching successful finalized CREATE receipt in guarded journals`)
    }
  }
  return created.length
}

export function formatAddressEnv(result) {
  const lines = [
    '# Generated from local mainnet deployment evidence (Foundry artifacts + guarded broadcaster journals).',
    '# Public addresses only. Review before sourcing. No private key or RPC credential is stored here.',
  ]
  for (const name of EXPECTED_MAINNET_CONTRACTS) {
    const address = result.contracts[name]
    if (address) lines.push(`${CONTRACT_ENV_KEYS[name]}=${address}`)
  }
  return `${lines.join('\n')}\n`
}
