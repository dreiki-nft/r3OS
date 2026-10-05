export const MAINNET_ORACLE_PROBE_SCHEMA = 'r3os-mainnet-oracle-probe/v1'
export const MON_USD_FEED = '0xBcD78f76005B7515837af6b50c7C52BCf73822fb'

const HASH = /^0x[0-9a-fA-F]{64}$/
const asNumber = (value) => Number(typeof value === 'bigint' ? value : BigInt(value ?? 0))

export function evaluateOracleProbe({ chainId, finalized, code, oracle }) {
  const finalizedOk =
    finalized &&
    asNumber(finalized.number) > 0 &&
    HASH.test(String(finalized.hash ?? '')) &&
    asNumber(finalized.timestamp) > 0
  const codePresent = typeof code === 'string' && code !== '0x' && code.length > 2
  const updatedAt = asNumber(oracle?.updatedAt ?? 0)
  const finalizedTs = asNumber(finalized?.timestamp ?? 0)
  const ageSeconds = finalizedOk && updatedAt > 0 ? finalizedTs - updatedAt : null
  const roundOk =
    BigInt(oracle?.roundId ?? 0) > 0n &&
    BigInt(oracle?.answeredInRound ?? 0) >= BigInt(oracle?.roundId ?? 0)

  const checks = {
    chain143: chainId === 143,
    finalizedAnchor: finalizedOk,
    codePresent,
    description: oracle?.description === 'MON / USD',
    decimals: Number(oracle?.decimals) === 8,
    positiveAnswer: BigInt(oracle?.answer ?? 0) > 0n,
    round: roundOk,
    nonFutureUpdate: ageSeconds != null && ageSeconds >= 0,
  }
  const pass = Object.values(checks).every(Boolean)
  return {
    schema: MAINNET_ORACLE_PROBE_SCHEMA,
    generatedAt: new Date().toISOString(),
    rpcUrlStored: false,
    feed: MON_USD_FEED,
    chainId,
    finalized: finalized
      ? { number: String(finalized.number), hash: finalized.hash, timestamp: String(finalized.timestamp) }
      : null,
    oracle: oracle
      ? {
          description: oracle.description,
          decimals: Number(oracle.decimals),
          roundId: String(oracle.roundId),
          answer: String(oracle.answer),
          updatedAt: String(oracle.updatedAt),
          answeredInRound: String(oracle.answeredInRound),
          ageSecondsAtFinalized: ageSeconds,
        }
      : null,
    checks,
    pass,
    policy: {
      automaticMaxAgeRecommendation: null,
      note: 'Do not derive MON_FEED_MAX_AGE from one sample. Compare observed age with the published Chainlink heartbeat/deviation policy and leave safety margin for update/finality timing.',
    },
  }
}

export function formatOracleProbe(result) {
  const c = result.checks
  return [
    '# r3OS MON/USD oracle probe',
    '',
    'READ ONLY. This does not choose a deployment freshness policy automatically.',
    '',
    `feed: ${result.feed}`,
    `chain: ${result.chainId}`,
    `finalized: ${result.finalized?.number ?? 'n/a'} ${result.finalized?.hash ?? ''}`.trim(),
    `description: ${result.oracle?.description ?? 'n/a'}`,
    `decimals: ${result.oracle?.decimals ?? 'n/a'}`,
    `round: ${result.oracle?.roundId ?? 'n/a'}`,
    `updatedAt: ${result.oracle?.updatedAt ?? 'n/a'}`,
    `age at finalized anchor: ${result.oracle?.ageSecondsAtFinalized ?? 'n/a'}s`,
    '',
    `[${c.chain143 ? 'OK' : 'FAIL'}] chain 143`,
    `[${c.finalizedAnchor ? 'OK' : 'FAIL'}] finalized anchor`,
    `[${c.codePresent ? 'OK' : 'FAIL'}] feed code`,
    `[${c.description ? 'OK' : 'FAIL'}] MON / USD description`,
    `[${c.decimals ? 'OK' : 'FAIL'}] 8 decimals`,
    `[${c.positiveAnswer ? 'OK' : 'FAIL'}] positive answer`,
    `[${c.round ? 'OK' : 'FAIL'}] round validity`,
    `[${c.nonFutureUpdate ? 'OK' : 'FAIL'}] update timestamp`,
    '',
    'POLICY: do not use this single observed age as the max-age setting. Check the published feed heartbeat/deviation policy and include timing margin.',
    `result: ${result.pass ? 'PROBE GREEN' : 'PROBE BLOCKED'}`,
    '',
  ].join('\n')
}
