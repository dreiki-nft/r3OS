import { createHash } from 'node:crypto'
import { validateAcceptanceGates } from './acceptance-gates-lib.mjs'

export const FLIGHT_RECORDER_SCHEMA = 'r3os-mainnet-launch/v1'
export const GENESIS_LABEL = 'R3OS_MAINNET_GENESIS'
export const EXPECTED_LAUNCH_CONTRACTS = Object.freeze([
  'R3OSPaint',
  'R3OSPainterPass',
  'R3OSLabs',
  'DiffRenderer',
  'SeasonTimelapseRenderer',
  'DF1Renderer',
  'R3OSFinaleAuction',
  'R3OSQuests',
  'R3OSRecycleBin',
  'R3OSCDBurner',
  'R3OSCardMemory',
  'R3OSPageExe',
  'R3OSBlockCamera',
  'R3OSOperatorRecord',
  'R3OSSystemEvent',
  'R3OSRouterLab',
])

const EXPECTED_REGISTRY_NAMES = Object.freeze([
  'finale auction', 'quests', 'recycle-bin', 'cd-burner', 'card-drv', 'page-exe',
  'block-camera', 'operator-record', 'system-event', 'router-lab',
])
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const BYTES32 = /^0x[0-9a-fA-F]{64}$/
const ZERO = '0x0000000000000000000000000000000000000000'
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isAddress = (value) => ADDRESS.test(String(value ?? '')) && String(value).toLowerCase() !== ZERO
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!plainObject(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  )
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`
}

export function sha256Hex(text) {
  return `0x${createHash('sha256').update(text).digest('hex')}`
}

export function validateDoctorEvidence(doctor) {
  const errors = []
  if (!plainObject(doctor)) return ['launch doctor JSON is required']
  if (doctor.tool !== 'r3os-launch-doctor') errors.push('launch doctor tool id is invalid')
  if (doctor.readOnly !== true) errors.push('launch doctor must be read-only')
  if (Number(doctor.chain?.id) !== 143) errors.push('launch doctor chain must be 143')
  if (doctor.chain?.matchesExpected !== true || Number(doctor.chain?.expectedId) !== 143) errors.push('launch doctor must explicitly match expected chain 143')
  if (doctor.commitment !== 'finalized') errors.push('launch doctor commitment must be finalized')
  if (!/^[0-9]+$/.test(String(doctor.block ?? ''))) errors.push('launch doctor finalized block is required')
  if (!BYTES32.test(String(doctor.blockHash ?? ''))) errors.push('launch doctor finalized block hash must be bytes32')
  if (doctor.exitCode !== 0) errors.push('launch doctor exitCode must be 0')
  if (Number(doctor.summary?.FAIL ?? 1) !== 0) errors.push('launch doctor must have zero FAIL checks')
  if (!plainObject(doctor.evidence)) errors.push('launch doctor structured evidence is required')
  return errors
}

export function assembleFlightRecord({ baseInput, doctor, manifest, acceptance }) {
  const doctorErrors = validateDoctorEvidence(doctor)
  const gateErrors = validateAcceptanceGates(acceptance)
  const errors = [...doctorErrors, ...gateErrors]
  if (!plainObject(baseInput)) errors.push('base flight input must be an object')
  if (!plainObject(manifest)) errors.push('deployment manifest JSON is required')
  else {
    if (manifest.schema !== 'r3os-mainnet-deployment/v1') errors.push('deployment manifest schema is invalid')
    if (Number(manifest.chainId) !== 143) errors.push('deployment manifest chainId must be 143')
  }
  if (errors.length) {
    const error = new Error(`cannot assemble flight record:\n- ${errors.join('\n- ')}`)
    error.errors = errors
    throw error
  }

  const manifestJson = canonicalJson(manifest)
  const evidence = doctor.evidence
  return canonicalize({
    ...baseInput,
    schema: FLIGHT_RECORDER_SCHEMA,
    genesisLabel: GENESIS_LABEL,
    chainId: 143,
    finalizedReference: { blockNumber: String(doctor.block), blockHash: doctor.blockHash },
    contracts: evidence.contracts,
    configuration: evidence.configuration,
    partners: evidence.partners,
    registry: evidence.registry,
    renderers: evidence.renderers,
    ownership: evidence.ownership,
    freezeStates: evidence.freezeStates,
    deploymentManifest: {
      schema: manifest.schema,
      sha256: sha256Hex(manifestJson),
      finalOwner: manifest.finalOwner,
      freezeIntentions: manifest.freezeIntentions,
    },
    gates: {
      ...(baseInput.gates ?? {}),
      launchDoctor: {
        commitment: doctor.commitment,
        exitCode: doctor.exitCode,
        summary: doctor.summary,
        blockNumber: String(doctor.block),
        blockHash: doctor.blockHash,
      },
      localAcceptance: acceptance,
    },
  })
}

export function validateFlightRecord(input) {
  const errors = []
  if (!plainObject(input)) return ['input must be a JSON object']
  if (input.schema !== FLIGHT_RECORDER_SCHEMA) errors.push(`schema must be ${FLIGHT_RECORDER_SCHEMA}`)
  if (Number(input.chainId) !== 143) errors.push('chainId must be 143')
  if (input.genesisLabel !== GENESIS_LABEL) errors.push(`genesisLabel must be ${GENESIS_LABEL}`)

  const reference = input.finalizedReference
  if (!plainObject(reference)) errors.push('finalizedReference is required')
  else {
    if (!/^[0-9]+$/.test(String(reference.blockNumber ?? ''))) errors.push('finalizedReference.blockNumber is required')
    if (!BYTES32.test(String(reference.blockHash ?? ''))) errors.push('finalizedReference.blockHash must be bytes32')
  }

  if (!plainObject(input.contracts)) errors.push('contracts must contain structured accepted deployment evidence')
  else {
    const seen = new Set()
    for (const name of EXPECTED_LAUNCH_CONTRACTS) {
      const contract = input.contracts[name]
      if (!plainObject(contract)) {
        errors.push(`contracts.${name} is required`)
        continue
      }
      if (!isAddress(contract.address)) errors.push(`contracts.${name}.address must be a non-zero address`)
      else {
        const key = contract.address.toLowerCase()
        if (seen.has(key)) errors.push(`contracts.${name}.address duplicates another launch contract`)
        seen.add(key)
      }
      if (!BYTES32.test(String(contract.codeHash ?? ''))) errors.push(`contracts.${name}.codeHash must be bytes32`)
    }
  }

  const doctor = input.gates?.launchDoctor
  if (!plainObject(doctor)) errors.push('gates.launchDoctor is required')
  else {
    if (doctor.commitment !== 'finalized') errors.push('gates.launchDoctor.commitment must be finalized')
    if (doctor.exitCode !== 0) errors.push('gates.launchDoctor.exitCode must be 0')
    if (reference && String(doctor.blockNumber) !== String(reference.blockNumber)) errors.push('launch doctor block must match finalizedReference')
    if (reference && !same(doctor.blockHash, reference.blockHash)) errors.push('launch doctor block hash must match finalizedReference')
  }

  const localErrors = validateAcceptanceGates(input.gates?.localAcceptance)
  errors.push(...localErrors.map((error) => `gates.localAcceptance: ${error}`))

  if (!plainObject(input.deploymentManifest)) errors.push('deploymentManifest is required')
  else {
    if (input.deploymentManifest.schema !== 'r3os-mainnet-deployment/v1') errors.push('deploymentManifest.schema is invalid')
    if (!BYTES32.test(String(input.deploymentManifest.sha256 ?? ''))) errors.push('deploymentManifest.sha256 must be bytes32')
  }

  const registry = Array.isArray(input.registry) ? input.registry : []
  const activeRegistryNames = new Set(registry.filter((entry) => !entry.retired).map((entry) => entry.name))
  for (const name of EXPECTED_REGISTRY_NAMES) if (!activeRegistryNames.has(name)) errors.push(`registry is missing active ${name}`)
  if (activeRegistryNames.has('router-mock-venues')) errors.push('registry must not contain active router-mock-venues on mainnet')

  for (const key of ['Paint', 'Labs', 'Painter Pass', 'Quests']) {
    const state = input.ownership?.[key]
    if (!plainObject(state) || state.status !== 'OK') errors.push(`ownership.${key} must be finalized OK`)
    else if (!isAddress(state.owner)) errors.push(`ownership.${key}.owner must be a non-zero address`)
  }
  const finalOwner = input.deploymentManifest?.finalOwner
  if (isAddress(finalOwner)) {
    for (const key of ['Paint', 'Labs', 'Painter Pass', 'Quests']) {
      const owner = input.ownership?.[key]?.owner
      if (isAddress(owner) && !same(owner, finalOwner)) errors.push(`ownership.${key}.owner must match deploymentManifest.finalOwner`)
    }
  }

  if (input.freezeStates?.experimentsFrozen !== false) errors.push('freezeStates.experimentsFrozen must be false for the reviewed launch policy')
  const rendererIntent = input.deploymentManifest?.freezeIntentions?.renderers
  if (rendererIntent === 'freeze-after-acceptance' && input.freezeStates?.renderersFrozen !== true) errors.push('renderers were intended to freeze but finalized evidence says they are open')
  if (rendererIntent === 'keep-open' && input.freezeStates?.renderersFrozen !== false) errors.push('renderers were intended to stay open but finalized evidence says they are frozen')

  for (const partner of ['skrumpeys', 'monadCards']) {
    const evidence = input.partners?.[partner]
    if (!plainObject(evidence) || evidence.matchesExpected !== true) errors.push(`partners.${partner} must match expected mainnet configuration`)
    else if (!BYTES32.test(String(evidence.codeHash ?? ''))) errors.push(`partners.${partner}.codeHash must be bytes32`)
  }

  return errors
}

export function makeFlightRecord(input) {
  const errors = validateFlightRecord(input)
  if (errors.length) {
    const error = new Error(`invalid flight record input:\n- ${errors.join('\n- ')}`)
    error.errors = errors
    throw error
  }
  const record = canonicalize(input)
  const json = canonicalJson(record)
  const hash = sha256Hex(json)
  return { record, json, hash }
}

export function formatFlightRecordText(record, hash) {
  const contracts = Object.entries(record.contracts ?? {})
    .map(([name, value]) => `${name}: ${value?.address ?? 'unknown'} · ${value?.codeHash ?? 'no hash'}`)
    .join('\n')
  return [
    'r3OS MAINNET FLIGHT RECORDER',
    `${record.genesisLabel}: ${hash}`,
    `chain: ${record.chainId}`,
    `finalized reference: #${record.finalizedReference.blockNumber} ${record.finalizedReference.blockHash}`,
    record.build?.gitIdentifier ? `build/git: ${record.build.gitIdentifier}` : undefined,
    `deployment manifest: ${record.deploymentManifest.sha256}`,
    '',
    'contracts',
    contracts || '(none)',
    '',
    'launch doctor',
    `commitment: ${record.gates.launchDoctor.commitment}`,
    `exit code: ${record.gates.launchDoctor.exitCode}`,
    `summary: ${JSON.stringify(record.gates.launchDoctor.summary ?? {})}`,
    '',
    `local acceptance: ${record.gates.localAcceptance.allGreen ? 'GREEN' : 'FAILED'}`,
    '',
    'The SHA-256 hash above is over the canonical mainnet-launch.json bytes.',
    'The existing R3OSSystemEvent contract is not a generic hash registry; do not overload it with this marker.',
  ]
    .filter((line) => line !== undefined)
    .join('\n') + '\n'
}
