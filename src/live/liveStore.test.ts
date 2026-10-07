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
  advanceObservedSessionUsage,
  burnerTopUpValue,
  paintEip712Name,
  MAX_BURNER_FUND,
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

  it('keeps the deployed testnet EIP-712 domain but uses r3OS for mainnet', () => {
    expect(paintEip712Name(10_143)).toBe('r3tards paint')
    expect(paintEip712Name(143)).toBe('r3OS paint')
    expect(paintEip712Name(31_337)).toBe('r3OS paint')
  })

  it('sweeps only the balance left after the quoted recipient-aware gas reserve', () => {
    expect(sweepAmount(100_000n, 21_000n, 2n)).toBe(58_000n)
    expect(sweepAmount(100_000n, 23_334n, 2n)).toBe(53_332n)
    expect(sweepAmount(46_668n, 23_334n, 2n)).toBe(0n)
    expect(sweepAmount(10_000n, 23_334n, 2n)).toBe(0n)
  })

  it('advances locally observed session usage without exceeding the session cap', () => {
    const session = {
      owner,
      expiryBlock: 100n,
      maxUnits: 20n,
      unitsSpent: 7n,
      revoked: false,
      active: true,
    }
    expect(advanceObservedSessionUsage(session, 5n)?.unitsSpent).toBe(12n)
    expect(advanceObservedSessionUsage(session, 50n)?.unitsSpent).toBe(20n)
  })
})

describe('burner top-up cap', () => {
  it('treats the entered amount as a request and clamps the transfer to remaining headroom', () => {
    expect(burnerTopUpValue(MAX_BURNER_FUND, 0n)).toBe(MAX_BURNER_FUND)
    expect(burnerTopUpValue(MAX_BURNER_FUND, 10n ** 16n)).toBe(MAX_BURNER_FUND - 10n ** 16n)
    expect(burnerTopUpValue(5n * 10n ** 17n, 2n * 10n ** 17n)).toBe(5n * 10n ** 17n)
    expect(burnerTopUpValue(1n, MAX_BURNER_FUND)).toBe(0n)
  })
})
