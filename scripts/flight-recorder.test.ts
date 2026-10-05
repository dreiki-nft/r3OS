import { describe, expect, it } from 'vitest'
import { ACCEPTANCE_GATES_SCHEMA, REQUIRED_LOCAL_GATES } from './acceptance-gates-lib.mjs'
import {
  EXPECTED_LAUNCH_CONTRACTS,
  FLIGHT_RECORDER_SCHEMA,
  GENESIS_LABEL,
  assembleFlightRecord,
  canonicalJson,
  makeFlightRecord,
  validateFlightRecord,
} from './flight-recorder-lib.mjs'

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`
const FINAL_OWNER = address(900)
const contracts = () => Object.fromEntries(
  EXPECTED_LAUNCH_CONTRACTS.map((name, index) => [name, { address: address(index + 1), codeHash: hash(index + 1) }]),
)
const registry = () => [
  'finale auction', 'quests', 'recycle-bin', 'cd-burner', 'card-drv', 'page-exe',
  'block-camera', 'operator-record', 'system-event', 'router-lab',
].map((name, id) => ({ id, name, address: address(100 + id), retired: false, codePresent: true, codeHash: hash(100 + id) }))
const acceptance = () => ({
  schema: ACCEPTANCE_GATES_SCHEMA,
  allGreen: true,
  gates: Object.fromEntries(REQUIRED_LOCAL_GATES.map((name) => [name, { command: name, exitCode: 0 }])),
})
const manifest = () => ({
  schema: 'r3os-mainnet-deployment/v1',
  chainId: 143,
  finalOwner: FINAL_OWNER,
  freezeIntentions: { renderers: 'freeze-after-acceptance', experiments: 'keep-open' },
})
const doctor = () => ({
  tool: 'r3os-launch-doctor',
  readOnly: true,
  chain: { id: 143, expectedId: 143, matchesExpected: true },
  commitment: 'finalized',
  block: '123456',
  blockHash: hash(777),
  summary: { OK: 100, WARN: 0, FAIL: 0, UNKNOWN: 0 },
  exitCode: 0,
  evidence: {
    contracts: contracts(),
    configuration: { seasonStart: '1800000000' },
    partners: {
      skrumpeys: { address: address(700), pixelsPerDay: '128', codePresent: true, codeHash: hash(700), matchesExpected: true },
      monadCards: { address: address(701), pixelsPerDay: '128', codePresent: true, codeHash: hash(701), matchesExpected: true },
    },
    registry: registry(),
    renderers: [],
    ownership: Object.fromEntries(['Paint', 'Labs', 'Painter Pass', 'Quests'].map((name) => [name, { owner: FINAL_OWNER, pendingOwner: address(0), expectedOwner: FINAL_OWNER, status: 'OK' }])),
    freezeStates: { renderersFrozen: true, experimentsFrozen: false },
  },
})
const base = () => ({
  schema: FLIGHT_RECORDER_SCHEMA,
  genesisLabel: GENESIS_LABEL,
  chainId: 143,
  build: { gitIdentifier: 'local-supplied-id' },
  deployment: { note: 'accepted mainnet deployment' },
})
const assembled = () => assembleFlightRecord({ baseInput: base(), doctor: doctor(), manifest: manifest(), acceptance: acceptance() })

describe('mainnet flight recorder', () => {
  it('canonicalizes object keys deterministically', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "z": 1\n}\n',
    )
  })

  it('assembles finalized doctor evidence so humans do not retype launch state', () => {
    const record = assembled()
    expect(record.finalizedReference).toEqual({ blockNumber: '123456', blockHash: hash(777) })
    expect(record.contracts.R3OSPaint).toEqual({ address: address(1), codeHash: hash(1) })
    expect(record.gates.launchDoctor).toMatchObject({ commitment: 'finalized', exitCode: 0, blockNumber: '123456' })
    expect(record.deploymentManifest.sha256).toMatch(/^0x[0-9a-f]{64}$/)
    expect(validateFlightRecord(record)).toEqual([])
  })

  it('produces the same genesis hash regardless of base-input key insertion order', () => {
    const a = base()
    const b = { deployment: a.deployment, build: a.build, chainId: a.chainId, genesisLabel: a.genesisLabel, schema: a.schema }
    const one = assembleFlightRecord({ baseInput: a, doctor: doctor(), manifest: manifest(), acceptance: acceptance() })
    const two = assembleFlightRecord({ baseInput: b, doctor: doctor(), manifest: manifest(), acceptance: acceptance() })
    expect(makeFlightRecord(one).hash).toBe(makeFlightRecord(two).hash)
  })

  it('fails closed when finalized evidence, local gates or code hashes are incomplete', () => {
    const badDoctor = doctor()
    badDoctor.commitment = 'proposed'
    expect(() => assembleFlightRecord({ baseInput: base(), doctor: badDoctor, manifest: manifest(), acceptance: acceptance() })).toThrow(/commitment must be finalized/)

    const record = assembled()
    record.contracts.R3OSPaint.codeHash = null
    record.gates.localAcceptance.gates.torture.exitCode = 1
    expect(validateFlightRecord(record)).toEqual(expect.arrayContaining([
      'contracts.R3OSPaint.codeHash must be bytes32',
      'gates.localAcceptance: acceptance gate torture must have exitCode 0',
    ]))
  })

  it('enforces ownership, registry and reviewed freeze intent', () => {
    const record = assembled()
    record.ownership.Paint.owner = address(999)
    record.registry = record.registry.filter((entry: any) => entry.name !== 'router-lab')
    record.freezeStates.renderersFrozen = false
    expect(validateFlightRecord(record)).toEqual(expect.arrayContaining([
      'ownership.Paint.owner must match deploymentManifest.finalOwner',
      'registry is missing active router-lab',
      'renderers were intended to freeze but finalized evidence says they are open',
    ]))
  })
})
