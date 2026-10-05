import { createHash } from 'node:crypto'

export const FLIGHT_RECORDER_SCHEMA = 'r3os-mainnet-launch/v1'
export const GENESIS_LABEL = 'R3OS_MAINNET_GENESIS'

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

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
    if (!/^0x[0-9a-fA-F]{64}$/.test(String(reference.blockHash ?? ''))) errors.push('finalizedReference.blockHash must be bytes32')
  }

  if (!plainObject(input.contracts) || !Object.keys(input.contracts).length) {
    errors.push('contracts must contain the accepted mainnet deployment addresses')
  }

  const doctor = input.gates?.launchDoctor
  if (!plainObject(doctor)) errors.push('gates.launchDoctor is required')
  else {
    if (doctor.commitment !== 'finalized') errors.push('gates.launchDoctor.commitment must be finalized')
    if (doctor.exitCode !== 0) errors.push('gates.launchDoctor.exitCode must be 0')
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
    .map(([name, value]) => `${name}: ${typeof value === 'string' ? value : value?.address ?? 'unknown'}`)
    .join('\n')
  return [
    'r3OS MAINNET FLIGHT RECORDER',
    `${record.genesisLabel}: ${hash}`,
    `chain: ${record.chainId}`,
    `finalized reference: #${record.finalizedReference.blockNumber} ${record.finalizedReference.blockHash}`,
    record.build?.gitIdentifier ? `build/git: ${record.build.gitIdentifier}` : undefined,
    '',
    'contracts',
    contracts || '(none)',
    '',
    'launch doctor',
    `commitment: ${record.gates.launchDoctor.commitment}`,
    `exit code: ${record.gates.launchDoctor.exitCode}`,
    '',
    'The SHA-256 hash above is over the canonical mainnet-launch.json bytes.',
    'The existing R3OSSystemEvent contract is not a generic hash registry; do not overload it with this marker.',
  ]
    .filter((line) => line !== undefined)
    .join('\n') + '\n'
}
