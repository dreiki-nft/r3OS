import { describe, expect, it } from 'vitest'
import {
  decodeP256Result,
  decodeReserveResult,
  decodeStakingEpoch,
  decodeStakingProposer,
  sourceForDeviceStatus,
} from './monadHardware'

const word = (value: bigint) => value.toString(16).padStart(64, '0')

describe('Monad hardware decoding', () => {
  it('decodes epoch + delay and proposer words', () => {
    expect(decodeStakingEpoch(`0x${word(42n)}${word(1n)}`)).toEqual({ epoch: 42n, inDelay: true })
    expect(decodeStakingProposer(`0x${word(182n)}`)).toBe(182n)
  })

  it('distinguishes reserve true, false and absent data', () => {
    expect(decodeReserveResult(`0x${word(1n)}`)).toBe(true)
    expect(decodeReserveResult(`0x${word(0n)}`)).toBe(false)
    expect(decodeReserveResult('0x')).toBeUndefined()
  })

  it('requires literal 1 from the P256 probe', () => {
    expect(decodeP256Result(`0x${word(1n)}`)).toBe(true)
    expect(decodeP256Result(`0x${word(2n)}`)).toBe(false)
    expect(decodeP256Result('0x')).toBeUndefined()
  })

  it('derives row sources from the probed device status', () => {
    expect(sourceForDeviceStatus('present')).toBe('onchain')
    expect(sourceForDeviceStatus('present', 'measured')).toBe('measured')
    expect(sourceForDeviceStatus('absent')).toBe('absent')
    expect(sourceForDeviceStatus('unknown')).toBe('unknown')
  })
})
