import { describe, expect, it } from 'vitest'
import {
  encodeAbiParameters,
  hashStruct,
  keccak256,
  parseAbiParameters,
  stringToHex,
  type Address,
} from 'viem'
import {
  START_SESSION_TYPES,
  START_SESSION_TYPE_STRING,
  sweepAmount,
  type StartSessionMessage,
} from './liveStore'

const owner = '0x0000000000000000000000000000000000000011' as Address
const sessionKey = '0x0000000000000000000000000000000000000022' as Address
const message: StartSessionMessage = {
  owner,
  sessionKey,
  expiryBlock: 24_123n,
  maxUnits: 5_000n,
  nonce: 7n,
  deadline: 1_900_000_000n,
}

describe('live session typed data', () => {
  it('matches the contract SESSION_TYPEHASH preimage', () => {
    expect(START_SESSION_TYPE_STRING).toBe(
      [
        'StartSession(address owner,address sessionKey,uint256 expiryBlock,uint256 maxUnits,',
        'uint256 nonce,uint256 deadline)',
      ].join(''),
    )
    const typehash = keccak256(stringToHex(START_SESSION_TYPE_STRING))
    const manual = keccak256(
      encodeAbiParameters(parseAbiParameters('bytes32,address,address,uint256,uint256,uint256,uint256'), [
        typehash,
        message.owner,
        message.sessionKey,
        message.expiryBlock,
        message.maxUnits,
        message.nonce,
        message.deadline,
      ]),
    )
    expect(hashStruct({ data: message, primaryType: 'StartSession', types: START_SESSION_TYPES })).toBe(
      manual,
    )
  })

  it('sweeps only the balance left after a 21k gas transfer', () => {
    expect(sweepAmount(100_000n, 2n)).toBe(58_000n)
    expect(sweepAmount(42_000n, 2n)).toBe(0n)
    expect(sweepAmount(10_000n, 2n)).toBe(0n)
  })
})
