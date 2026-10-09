import { describe, expect, it } from 'vitest'
import { inspectSubmissionReplay } from './submission-smoke-lib.mjs'

const valid = {
  version: 1,
  chainId: 143,
  season: 0,
  paint: '0x5102de3817ae16b3afaeb9d180130669a70787b3',
  fromBlock: '111000000',
  toBlock: '111000100',
  painters: ['0x123'],
  events: [[0, 0, '0x', '0x']],
}

describe('offline submission replay smoke', () => {
  it('accepts mainnet replay metadata with events', () => {
    expect(inspectSubmissionReplay(valid, 0)).toEqual([])
  })
  it('refuses a missing, empty or wrong-chain replay', () => {
    expect(inspectSubmissionReplay(undefined, 0)).toContain('replay is not an object')
    expect(inspectSubmissionReplay({ ...valid, events: [] }, 0)).toContain('no paint events')
    expect(inspectSubmissionReplay({ ...valid, chainId: 10143 }, 0)).toContain(
      'expected Monad mainnet chainId 143',
    )
    expect(inspectSubmissionReplay({ ...valid, season: 1 }, 0)).toContain('season index must be 0')
  })
  it('catches a reversed block interval', () => {
    expect(inspectSubmissionReplay({ ...valid, fromBlock: '200', toBlock: '100' }, 0)).toContain(
      'invalid block range',
    )
  })
})
