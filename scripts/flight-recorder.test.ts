import { describe, expect, it } from 'vitest'
import {
  FLIGHT_RECORDER_SCHEMA,
  GENESIS_LABEL,
  canonicalJson,
  makeFlightRecord,
  validateFlightRecord,
} from './flight-recorder-lib.mjs'

const input = () => ({
  schema: FLIGHT_RECORDER_SCHEMA,
  genesisLabel: GENESIS_LABEL,
  chainId: 143,
  build: { gitIdentifier: 'local-supplied-id' },
  finalizedReference: { blockNumber: '123456', blockHash: `0x${'ab'.repeat(32)}` },
  contracts: { R3OSPaint: { address: '0x0000000000000000000000000000000000000001' } },
  gates: { launchDoctor: { commitment: 'finalized', exitCode: 0 } },
})

describe('mainnet flight recorder', () => {
  it('canonicalizes object keys deterministically', () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{\n  "a": {\n    "b": 3,\n    "y": 2\n  },\n  "z": 1\n}\n',
    )
  })

  it('produces the same genesis hash regardless of input key insertion order', () => {
    const a = input()
    const b = {
      gates: a.gates,
      contracts: a.contracts,
      finalizedReference: a.finalizedReference,
      chainId: a.chainId,
      genesisLabel: a.genesisLabel,
      build: a.build,
      schema: a.schema,
    }
    expect(makeFlightRecord(a).hash).toBe(makeFlightRecord(b).hash)
  })

  it('fails closed when launch certification is not finalized and green', () => {
    const bad = input()
    bad.gates.launchDoctor = { commitment: 'unknown', exitCode: 1 }
    expect(validateFlightRecord(bad)).toEqual(
      expect.arrayContaining([
        'gates.launchDoctor.commitment must be finalized',
        'gates.launchDoctor.exitCode must be 0',
      ]),
    )
  })
})
