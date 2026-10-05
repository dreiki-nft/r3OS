import { describe, expect, it } from 'vitest'
import { evaluateOracleProbe, formatOracleProbe, MON_USD_FEED } from './mainnet-oracle-probe-lib.mjs'

const good = () => ({
  chainId: 143,
  finalized: {
    number: 100n,
    hash: `0x${'11'.repeat(32)}`,
    timestamp: 10_000n,
  },
  code: '0x6000',
  oracle: {
    description: 'MON / USD',
    decimals: 8,
    roundId: 9n,
    answer: 33300000n,
    updatedAt: 9_940n,
    answeredInRound: 9n,
  },
})

describe('mainnet MON/USD oracle probe', () => {
  it('accepts the expected feed shape at one finalized anchor without inventing max-age policy', () => {
    const result = evaluateOracleProbe(good())
    expect(result.pass).toBe(true)
    expect(result.feed).toBe(MON_USD_FEED)
    expect(result.oracle?.ageSecondsAtFinalized).toBe(60)
    expect(result.policy.automaticMaxAgeRecommendation).toBeNull()
    expect(result.rpcUrlStored).toBe(false)
  })

  it('fails closed on the wrong chain or malformed feed identity', () => {
    const wrong = good()
    wrong.chainId = 10143
    wrong.oracle.description = 'NOT MON / USD'
    const result = evaluateOracleProbe(wrong)
    expect(result.pass).toBe(false)
    expect(result.checks.chain143).toBe(false)
    expect(result.checks.description).toBe(false)
  })

  it('labels a single observed age as evidence rather than a heartbeat recommendation', () => {
    const text = formatOracleProbe(evaluateOracleProbe(good()))
    expect(text).toContain('age at finalized anchor: 60s')
    expect(text).toContain('do not use this single observed age as the max-age setting')
  })
})
