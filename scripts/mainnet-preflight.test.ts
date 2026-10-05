import { describe, expect, it } from 'vitest'
import { evaluateMainnetPreflight, STATUS } from './mainnet-preflight-lib.mjs'
import { OFFICIAL_MAINNET } from './mainnet-manifest-lib.mjs'

const hash = (char: string) => `0x${char.repeat(64)}`
const manifest = () => ({
  deployer: '0x1111111111111111111111111111111111111111',
  seasonStart: 2_000_010_000,
  systemEvent: { monUsdFeed: OFFICIAL_MAINNET.monUsdFeed, maxAgeSeconds: 300 },
})
const code = () => ({ r3tards: '0x6001', skrumpeys: '0x6002', monadCards: '0x6003', monUsdFeed: '0x6004', multicall3: '0x6005' })
const codeHashes = () => ({ r3tards: hash('1'), skrumpeys: hash('2'), monadCards: hash('3'), monUsdFeed: hash('4'), multicall3: hash('5') })
const oracle = () => ({ description: 'MON / USD', decimals: 8, roundId: 10n, answer: 123_000_000n, updatedAt: 1_999_999_950n, answeredInRound: 10n })

function evaluate(overrides: Record<string, unknown> = {}) {
  return evaluateMainnetPreflight({
    manifest: manifest(),
    manifestHash: hash('a'),
    chainId: 143,
    finalized: { number: 100n, hash: hash('b'), timestamp: 2_000_000_000n },
    latest: { number: 101n, hash: hash('c'), timestamp: 2_000_000_001n, baseFeePerGas: 100_000_000_000n },
    code: code(),
    codeHashes: codeHashes(),
    oracle: oracle(),
    deployerBalanceWei: 10n ** 18n,
    priorityFeeWei: 2_000_000_000n,
    ...overrides,
  })
}

describe('mainnet preflight', () => {
  it('accepts a finalized chain-143 dependency/oracle snapshot without treating fee suggestion as policy', () => {
    const result = evaluate()
    expect(result.readyForDeploymentApproval).toBe(true)
    expect(result.rpcUrlStored).toBe(false)
    expect(result.summary.FAIL).toBe(0)
    expect(result.checks.find((item) => item.id === 'priority-fee-suggestion')?.status).toBe(STATUS.WARN)
    expect(result.dependencies.multicall3.address).toBe(OFFICIAL_MAINNET.multicall3)
  })

  it('fails closed when finalized dependency code or oracle freshness is wrong', () => {
    const badCode = code()
    badCode.monadCards = '0x'
    const badOracle = { ...oracle(), updatedAt: 1_999_999_000n }
    const result = evaluate({ code: badCode, oracle: badOracle })
    expect(result.readyForDeploymentApproval).toBe(false)
    expect(result.checks.find((item) => item.id === 'code:monadCards')?.status).toBe(STATUS.FAIL)
    expect(result.checks.find((item) => item.id === 'oracle:freshness')?.status).toBe(STATUS.FAIL)
  })

  it('blocks an expired season start and warns when launch lead is under one hour', () => {
    const expired = { ...manifest(), seasonStart: 1_999_999_999 }
    expect(evaluate({ manifest: expired }).checks.find((item) => item.id === 'season-start')?.status).toBe(STATUS.FAIL)

    const tight = { ...manifest(), seasonStart: 2_000_000_301 }
    const result = evaluate({ manifest: tight })
    expect(result.readyForDeploymentApproval).toBe(true)
    expect(result.checks.find((item) => item.id === 'season-start')?.status).toBe(STATUS.WARN)
  })
})
