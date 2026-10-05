import { createHash } from 'node:crypto'

export const MAINNET_MANIFEST_SCHEMA = 'r3os-mainnet-deployment/v1'
export const MAINNET_CHAIN_ID = 143
export const OFFICIAL_MAINNET = Object.freeze({
  r3tards: '0x200723A706de0013316E5cd8EBa2b3f53DD90c29',
  skrumpeys: '0xB0DAD798C80e40Dd6b8E8545074C6a5B7B97D2c0',
  monadCards: '0x0000CA12D5c07085022eBC74867157449919Fd67',
  monUsdFeed: '0xBcD78f76005B7515837af6b50c7C52BCf73822fb',
})
export const EXPECTED_MAINNET_BUDGETS = Object.freeze({
  basePixelsPerHour: 512,
  pixelsPerActiveDay: 32,
  maxPixelsPerHour: 2048,
  minPixelsForActiveDay: 16,
  holderPixelsPerDay: 512,
  skrumpeysPixelsPerDay: 128,
  monadCardPixelsPerDay: 128,
})

export const DEPLOYMENT_STEPS = Object.freeze([
  Object.freeze({ id: 'core', order: 1, script: 'Deploy.s.sol:Deploy', approval: 'DEPLOYMENT', creates: [
    'R3OSPaint', 'R3OSLabs', 'DiffRenderer', 'SeasonTimelapseRenderer', 'DF1Renderer',
    'R3OSPainterPass', 'R3OSFinaleAuction', 'R3OSQuests', 'R3OSRecycleBin', 'R3OSCDBurner',
  ] }),
  Object.freeze({ id: 'card', order: 2, script: 'DeployMonadCard.s.sol:DeployMonadCard', approval: 'DEPLOYMENT', creates: ['R3OSCardMemory'] }),
  Object.freeze({ id: 'hardware', order: 3, script: 'DeployMonadHW.s.sol:DeployMonadHW', approval: 'DEPLOYMENT', creates: ['R3OSPageExe', 'R3OSBlockCamera'] }),
  Object.freeze({ id: 'operator', order: 4, script: 'DeployOperator.s.sol:DeployOperator', approval: 'DEPLOYMENT', creates: ['R3OSOperatorRecord', 'R3OSSystemEvent'] }),
  Object.freeze({ id: 'router', order: 5, script: 'DeployRouterLab.s.sol:DeployRouterLab', approval: 'DEPLOYMENT', creates: ['R3OSRouterLab'] }),
  Object.freeze({ id: 'preaccept-doctor', order: 6, command: 'npm run launch:doctor', approval: 'READ_ONLY' }),
  Object.freeze({ id: 'accept-ownership', order: 7, approval: 'IRREVERSIBLE_ADMIN', creates: [] }),
  Object.freeze({ id: 'optional-freezes', order: 8, approval: 'IRREVERSIBLE_FREEZE', creates: [] }),
  Object.freeze({ id: 'postaccept-doctor', order: 9, command: 'npm run launch:doctor', approval: 'READ_ONLY' }),
  Object.freeze({ id: 'flight-recorder', order: 10, command: 'npm run flight:record', approval: 'EVIDENCE_ONLY' }),
])

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const isAddress = (value) => ADDRESS.test(String(value ?? ''))
const zero = '0x0000000000000000000000000000000000000000'
const sameAddress = (a, b) => isAddress(a) && isAddress(b) && a.toLowerCase() === b.toLowerCase()
const positiveInteger = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const str = (value) => (value == null ? '' : String(value))
const yes = (value) => (value ? 'yes' : 'no')

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!plainObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`
}

export function sha256Hex(text) {
  return `0x${createHash('sha256').update(text).digest('hex')}`
}

function addressField(errors, input, key, { allowOfficialMismatch = false, official } = {}) {
  const value = input?.[key]
  if (!isAddress(value) || sameAddress(value, zero)) errors.push(`${key} must be a non-zero address`)
  else if (official && !allowOfficialMismatch && !sameAddress(value, official)) errors.push(`${key} must be ${official}`)
}

function validatePublicUrl(errors, label, value, { websocket = false } = {}) {
  if (!value) return errors.push(`${label} is required`)
  try {
    const url = new URL(value)
    const allowed = websocket ? ['ws:', 'wss:'] : ['http:', 'https:']
    if (!allowed.includes(url.protocol)) errors.push(`${label} must use ${allowed.join(' or ')}`)
    if (url.username || url.password) errors.push(`${label} must not contain URL credentials`)
  } catch {
    errors.push(`${label} must be a valid URL`)
  }
}

export function validateManifestInput(input) {
  const errors = []
  if (!plainObject(input)) return ['input must be a JSON object']
  if (input.schema !== MAINNET_MANIFEST_SCHEMA) errors.push(`schema must be ${MAINNET_MANIFEST_SCHEMA}`)
  if (input.reviewed !== true) errors.push('reviewed must be true after human review of every manifest field')
  if (Number(input.chainId) !== MAINNET_CHAIN_ID) errors.push('chainId must be 143')

  for (const key of ['deployer', 'finalOwner', 'tokenZeroRecipient', 'royaltyReceiver']) addressField(errors, input, key)
  addressField(errors, input, 'r3tards', { official: OFFICIAL_MAINNET.r3tards })

  if (!plainObject(input.partners)) errors.push('partners is required')
  else {
    addressField(errors, input.partners, 'skrumpeys', { official: OFFICIAL_MAINNET.skrumpeys })
    addressField(errors, input.partners, 'monadCards', { official: OFFICIAL_MAINNET.monadCards })
  }

  if (!positiveInteger(input.seasonStart)) errors.push('seasonStart must be a positive unix timestamp')
  if (!plainObject(input.budgets)) errors.push('budgets is required')
  else {
    for (const [key, expected] of Object.entries(EXPECTED_MAINNET_BUDGETS)) {
      if (Number(input.budgets[key]) !== expected) errors.push(`budgets.${key} must be ${expected}`)
    }
  }

  if (!plainObject(input.systemEvent)) errors.push('systemEvent is required')
  else {
    addressField(errors, input.systemEvent, 'monUsdFeed', { official: OFFICIAL_MAINNET.monUsdFeed })
    if (!positiveInteger(input.systemEvent.triggerMilliUsd)) errors.push('systemEvent.triggerMilliUsd must be a positive integer')
    if (!positiveInteger(input.systemEvent.maxAgeSeconds)) errors.push('systemEvent.maxAgeSeconds must be a positive integer chosen after checking the live feed heartbeat')
  }

  if (!plainObject(input.freezeIntentions)) errors.push('freezeIntentions is required')
  else {
    if (!['keep-open', 'freeze-after-acceptance'].includes(input.freezeIntentions.renderers)) {
      errors.push('freezeIntentions.renderers must be keep-open or freeze-after-acceptance')
    }
    if (input.freezeIntentions.experiments !== 'keep-open') {
      errors.push('freezeIntentions.experiments must be keep-open for the reviewed Phase 9 launch policy')
    }
  }

  if (!plainObject(input.frontend)) errors.push('frontend public RPC/WS configuration is required before deployment')
  else {
    if (!Array.isArray(input.frontend.rpcUrls) || input.frontend.rpcUrls.length < 2) errors.push('frontend.rpcUrls must contain at least two public/read-safe RPC URLs')
    else input.frontend.rpcUrls.forEach((url, index) => validatePublicUrl(errors, `frontend.rpcUrls[${index}]`, url))
    validatePublicUrl(errors, 'frontend.walletRpcUrl', input.frontend.walletRpcUrl)
    validatePublicUrl(errors, 'frontend.wsUrl', input.frontend.wsUrl, { websocket: true })
    validatePublicUrl(errors, 'frontend.explorerUrl', input.frontend.explorerUrl)
    if (input.frontend.fastlaneAcceleratorUrl) validatePublicUrl(errors, 'frontend.fastlaneAcceleratorUrl', input.frontend.fastlaneAcceleratorUrl)
  }

  if (input.confirmMainnet !== true) errors.push('confirmMainnet must be true in the reviewed manifest input')
  if (typeof input.labBaseUri !== 'string') errors.push('labBaseUri must be a string (blank is allowed)')
  return errors
}

export function makeManifest(input) {
  const errors = validateManifestInput(input)
  if (errors.length) {
    const error = new Error(`invalid mainnet manifest input:\n- ${errors.join('\n- ')}`)
    error.errors = errors
    throw error
  }
  const normalized = canonicalize({
    ...input,
    chainId: MAINNET_CHAIN_ID,
    deploymentOrder: DEPLOYMENT_STEPS.map(({ id, order, script, command, approval }) => ({ id, order, script, command, approval })),
  })
  const json = canonicalJson(normalized)
  const hash = sha256Hex(json)
  return { manifest: normalized, json, hash, markdown: formatManifestMarkdown(normalized, hash) }
}

const code = (value) => `\`${value}\``
const addr = (value) => code(value)
const envRow = (name, value, note = '') => `| ${code(name)} | ${value === '' ? 'blank' : code(value)} | ${note} |`

export function formatManifestMarkdown(input, manifestHash) {
  const b = input.budgets
  const f = input.frontend
  const s = input.systemEvent
  const lines = [
    '# r3OS Mainnet Deployment Plan',
    '',
    '> **PLAN ONLY. THIS FILE IS NOT AUTHORIZATION TO BROADCAST, ACCEPT OWNERSHIP, FREEZE, OR EMIT A CANONICAL GENESIS MARKER.**',
    '',
    `Manifest schema: ${code(input.schema)}`,
    `Human-reviewed input: **${yes(input.reviewed)}**`,
    `Manifest SHA-256: ${code(manifestHash)}`,
    `Chain: Monad Mainnet (${code(String(input.chainId))})`,
    '',
    '## Reviewed launch identities',
    '',
    `- Deployer / initial owner: ${addr(input.deployer)}`,
    `- Final owner: ${addr(input.finalOwner)}`,
    `- Token #0 recipient: ${addr(input.tokenZeroRecipient)}`,
    `- Royalty receiver: ${addr(input.royaltyReceiver)}`,
    `- r3tards: ${addr(input.r3tards)}`,
    `- Skrumpeys: ${addr(input.partners.skrumpeys)}`,
    `- Monad Cards: ${addr(input.partners.monadCards)}`,
    '',
    '## Paint launch configuration',
    '',
    `- Season start: ${code(String(input.seasonStart))} (${new Date(Number(input.seasonStart) * 1000).toISOString()})`,
    `- Base budget: ${code(String(b.basePixelsPerHour))} px/hour`,
    `- Active-day step: ${code(String(b.pixelsPerActiveDay))} px`,
    `- Hour cap: ${code(String(b.maxPixelsPerHour))} px/hour`,
    `- Active-day threshold: ${code(String(b.minPixelsForActiveDay))} px`,
    `- r3tards: +${code(String(b.holderPixelsPerDay))} px/day per owned token`,
    `- Skrumpeys: +${code(String(b.skrumpeysPixelsPerDay))} px/day per holder wallet`,
    `- Monad Cards: +${code(String(b.monadCardPixelsPerDay))} px/day per holder wallet`,
    `- EIP-712 mainnet target: ${code('r3OS paint')} / version ${code('2')}`,
    '',
    '## Public frontend RPC / WebSocket configuration',
    '',
    'These values are browser-visible. No unrestricted secret may appear here.',
    '',
    `- Read pool: ${f.rpcUrls.map(code).join(', ')}`,
    `- Wallet/action RPC: ${code(f.walletRpcUrl)}`,
    `- WebSocket: ${code(f.wsUrl)}`,
    `- Explorer: ${code(f.explorerUrl)}`,
    `- Optional stateless FastLane accelerator: ${f.fastlaneAcceleratorUrl ? code(f.fastlaneAcceleratorUrl) : 'disabled'}`,
    '',
    'The FastLane Enterprise credential is never browser-visible. If configured, only the public Cloudflare Worker route appears here. Direct public Monad RPC remains the fallback/canonical browser path, and this manifest makes no RPC-tier transaction-priority claim.',
    '',
    '## System Event configuration',
    '',
    `- MON/USD feed: ${addr(s.monUsdFeed)}`,
    `- Trigger: ${code(String(s.triggerMilliUsd))} milli-USD`,
    `- Max age: ${code(String(s.maxAgeSeconds))} seconds`,
    '- `MON_FEED_MAX_AGE` must be chosen from the live mainnet feed heartbeat immediately before deployment.',
    '',
    '## Exact deployment sequence',
    '',
    '| # | Step | Command/script | Creates / action | Approval class |',
    '|---:|---|---|---|---|',
    `| 1 | Core | ${code('Deploy.s.sol:Deploy')} | R3OSPaint, R3OSLabs, renderers, Pass, Finale, Quests, Recycle, CDBurner | **DEPLOYMENT** |`,
    `| 2 | CARD.DRV | ${code('DeployMonadCard.s.sol:DeployMonadCard')} | R3OSCardMemory + Paint/Pass/Quest registration | **DEPLOYMENT** |`,
    `| 3 | Monad Hardware | ${code('DeployMonadHW.s.sol:DeployMonadHW')} | R3OSPageExe + R3OSBlockCamera + owner-only Paint registration | **DEPLOYMENT** |`,
    `| 4 | Operator/System Event | ${code('DeployOperator.s.sol:DeployOperator')} | R3OSOperatorRecord + R3OSSystemEvent | **DEPLOYMENT** |`,
    `| 5 | Router Lab | ${code('DeployRouterLab.s.sol:DeployRouterLab')} | R3OSRouterLab | **DEPLOYMENT** |`,
    `| 6 | Pre-acceptance certification | ${code('npm run launch:doctor')} | Finalized, read-only checks | READ ONLY |`,
    `| 7 | Ownership acceptance | ${code('acceptOwnership()')} | Paint, Labs, Pass, Quests | **IRREVERSIBLE ADMIN GATE** |`,
    `| 8 | Optional freezes | ${code('freezeRenderers()')} / ${code('freezeExperiments()')} | only if reviewed intent says so | **IRREVERSIBLE FREEZE GATE** |`,
    `| 9 | Post-acceptance certification | ${code('npm run launch:doctor')} | Finalized acceptance state | READ ONLY |`,
    `| 10 | Flight Recorder | ${code('npm run flight:record')} | deterministic accepted launch artifact/hash | EVIDENCE ONLY |`,
    '',
    '### Ordering invariant that must not be violated',
    '',
    '**Do not let the final owner accept Paint ownership before Monad Hardware registration completes.** `DeployMonadHW.s.sol` calls `Paint.addExperiment(...)` directly and has no Safe-calldata fallback. CARD.DRV also precedes Hardware because Block Camera stores `CARD_MEMORY` immutably in its constructor.',
    '',
    '## Constructor / immutable map',
    '',
    `- ${code('R3OSPaint')}: (${addr(input.r3tards)}, seasonStart, ${addr(input.deployer)}, ${addr(input.royaltyReceiver)}, ${b.basePixelsPerHour}, ${b.pixelsPerActiveDay}, ${b.maxPixelsPerHour}, ${b.minPixelsForActiveDay}, ${b.holderPixelsPerDay})`,
    `- ${code('R3OSLabs')}: (Paint, ${addr(input.royaltyReceiver)})`,
    `- ${code('DiffRenderer')}: ()`,
    `- ${code('SeasonTimelapseRenderer')}: ()`,
    `- ${code('DF1Renderer')}: ()`,
    `- ${code('R3OSPainterPass')}: (Paint)`,
    `- ${code('R3OSFinaleAuction')}: (Paint)`,
    `- ${code('R3OSQuests')}: (Paint, seasonStart, ${addr(input.deployer)})`,
    `- ${code('R3OSRecycleBin')}: (Paint)`,
    `- ${code('R3OSCDBurner')}: (Paint, Labs)`,
    `- ${code('R3OSCardMemory')}: (${addr(input.partners.monadCards)})`,
    `- ${code('R3OSPageExe')}: ()`,
    `- ${code('R3OSBlockCamera')}: (Paint, Labs, CardMemory)`,
    `- ${code('R3OSOperatorRecord')}: sources resolved from the accepted Paint registry`,
    `- ${code('R3OSSystemEvent')}: (${addr(s.monUsdFeed)}, ${s.triggerMilliUsd}, ${s.maxAgeSeconds})`,
    `- ${code('R3OSRouterLab')}: ()`,
    '',
    '## Registry / wiring intent',
    '',
    '- Renderers: built-in, diff, season timelapse, df1.',
    '- Experiments: finale auction, quests, recycle-bin, cd-burner, card-drv, page-exe, block-camera, operator-record, system-event, router-lab.',
    '- Pass stamp sources: quests, recycle-bin, card-drv.',
    '- Bound experiment ids: recycle-bin, cd-burner, block-camera.',
    '- Mainnet must not contain the test-only `router-mock-venues` entry.',
    '',
    '## Freeze intentions',
    '',
    `- Renderers: **${input.freezeIntentions.renderers}**`,
    `- Experiments: **${input.freezeIntentions.experiments}**`,
    '- Any freeze transaction requires a separate explicit approval immediately before broadcast.',
    '',
    '## Foundry environment contract',
    '',
    '| Variable | Reviewed value | Note |',
    '|---|---|---|',
    envRow('DEPLOYER_ADDRESS', input.deployer, 'must match the broadcasting account'),
    envRow('R3TARDS_ADDRESS', input.r3tards, 'official collection'),
    envRow('SEASON_START', String(input.seasonStart)),
    envRow('TOKEN_ZERO_RECIPIENT', input.tokenZeroRecipient),
    envRow('ROYALTY_RECEIVER', input.royaltyReceiver),
    envRow('FINAL_OWNER', input.finalOwner, 'Ownable2Step target; do not accept early'),
    envRow('BASE_PIXELS_PER_HOUR', String(b.basePixelsPerHour)),
    envRow('PIXELS_PER_ACTIVE_DAY', String(b.pixelsPerActiveDay)),
    envRow('MAX_PIXELS_PER_HOUR', String(b.maxPixelsPerHour)),
    envRow('MIN_PIXELS_FOR_ACTIVE_DAY', String(b.minPixelsForActiveDay)),
    envRow('HOLDER_PIXELS_PER_DAY', String(b.holderPixelsPerDay)),
    envRow('LAB_BASE_URI', input.labBaseUri),
    envRow('CONFIRM_MAINNET', yes(input.confirmMainnet), '**mainnet broadcast guard**'),
    envRow('MONAD_CARD_ADDRESS', input.partners.monadCards),
    envRow('MON_USD_FEED', s.monUsdFeed),
    envRow('MON_PRICE_TRIGGER_MILLI_USD', String(s.triggerMilliUsd)),
    envRow('MON_FEED_MAX_AGE', String(s.maxAgeSeconds), 'must be re-confirmed against live heartbeat'),
    '',
    'Add-on scripts also require the addresses emitted by earlier steps (`PAINT_ADDRESS`, `PASS_ADDRESS`, `QUESTS_ADDRESS`, `LABS_ADDRESS`, `CARD_MEMORY_ADDRESS`). Populate them only from the reviewed deployment outputs.',
    '',
    '## Verification / acceptance commands',
    '',
    '```bash',
    'npm run test:speculation',
    'npm run test:torture',
    'npm run repo:doctor',
    'npm run test:web',
    'npm run generated:check',
    'npx tsc -b',
    'npm run build',
    'npm run contracts:build',
    'npm run contracts:test',
    'git diff --check',
    '',
    '# after deployment, with a local RPC_URL and no secret on argv:',
    'EXPECTED_CHAIN_ID=143 PAINT_ADDRESS=<paint> EXPECTED_OWNER=<finalOwner> npm run launch:doctor -- --json',
    '```',
    '',
    '## Mandatory STOP gates',
    '',
    '1. **STOP before the first mainnet deployment broadcast.** Human approval is required at that exact step.',
    '2. **STOP before final-owner `acceptOwnership()` calls.** Re-run the pre-acceptance finalized Launch Doctor first.',
    '3. **STOP before any freeze.** A freeze is optional and irreversible.',
    '4. **STOP before treating a Flight Recorder hash as canonical launch evidence.** Post-acceptance finalized certification and 9D split-brain/canary acceptance must pass first.',
    '',
    '## Genesis evidence',
    '',
    'The deterministic Flight Recorder SHA-256 is labeled `R3OS_MAINNET_GENESIS`. `R3OSSystemEvent` is not a generic hash registry and must not be overloaded to store the marker.',
    '',
  ]
  return lines.join('\n')
}
