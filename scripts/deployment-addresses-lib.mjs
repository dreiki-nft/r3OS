const ADDRESS = /^0x[0-9a-fA-F]{40}$/

export const MAINNET_BROADCAST_FILES = Object.freeze([
  'Deploy.s.sol/143/run-latest.json',
  'DeployMonadCard.s.sol/143/run-latest.json',
  'DeployMonadHW.s.sol/143/run-latest.json',
  'DeployOperator.s.sol/143/run-latest.json',
  'DeployRouterLab.s.sol/143/run-latest.json',
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

export function mergeDeploymentRuns(runs) {
  const byName = new Map()
  for (const item of runs.flatMap(({ run, source }) => extractCreatedContracts(run, source))) {
    const prior = byName.get(item.contractName)
    if (prior && normalizeAddress(prior.address) !== normalizeAddress(item.address)) {
      throw new Error(`conflicting ${item.contractName} addresses: ${prior.address} vs ${item.address}`)
    }
    byName.set(item.contractName, item)
  }
  const missing = EXPECTED_MAINNET_CONTRACTS.filter((name) => !byName.has(name))
  const contracts = Object.fromEntries(EXPECTED_MAINNET_CONTRACTS.filter((name) => byName.has(name)).map((name) => [name, byName.get(name).address]))
  return { contracts, missing, complete: missing.length === 0 }
}

export function formatAddressEnv(result) {
  const lines = [
    '# Generated from local Foundry broadcast artifacts. Public addresses only.',
    '# Review before sourcing. This file contains no private key or RPC credential.',
  ]
  for (const name of EXPECTED_MAINNET_CONTRACTS) {
    const address = result.contracts[name]
    if (address) lines.push(`${CONTRACT_ENV_KEYS[name]}=${address}`)
  }
  return `${lines.join('\n')}\n`
}
