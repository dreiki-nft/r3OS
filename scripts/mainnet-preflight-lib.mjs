import { formatEther } from 'viem'
import { OFFICIAL_MAINNET } from './mainnet-manifest-lib.mjs'

export const MAINNET_PREFLIGHT_SCHEMA = 'r3os-mainnet-preflight/v1'
export const STATUS = Object.freeze({ OK: 'OK', WARN: 'WARN', FAIL: 'FAIL' })

export const REQUIRED_MAINNET_CODE = Object.freeze([
  Object.freeze({ id: 'r3tards', addressKey: 'r3tards' }),
  Object.freeze({ id: 'skrumpeys', addressKey: 'skrumpeys' }),
  Object.freeze({ id: 'monadCards', addressKey: 'monadCards' }),
  Object.freeze({ id: 'monUsdFeed', addressKey: 'monUsdFeed' }),
  Object.freeze({ id: 'multicall3', addressKey: 'multicall3' }),
])

const HASH = /^0x[0-9a-fA-F]{64}$/
const hasCode = (value) => typeof value === 'string' && value !== '0x' && value.length > 2
const asNumber = (value) => Number(typeof value === 'bigint' ? value : BigInt(value ?? 0))
const check = (id, status, detail, value) => ({ id, status, detail, ...(value === undefined ? {} : { value }) })

export function summarizePreflight(checks) {
  const summary = { OK: 0, WARN: 0, FAIL: 0 }
  for (const item of checks) summary[item.status] = (summary[item.status] ?? 0) + 1
  return summary
}

export function evaluateMainnetPreflight({
  manifest,
  manifestHash,
  chainId,
  finalized,
  latest,
  code = {},
  codeHashes = {},
  oracle,
  deployerBalanceWei,
  priorityFeeWei,
}) {
  const checks = []
  checks.push(check('chain-id', chainId === 143 ? STATUS.OK : STATUS.FAIL, chainId === 143 ? 'Monad Mainnet' : 'expected chain 143', chainId))

  const finalizedOk = finalized && Number.isSafeInteger(asNumber(finalized.number)) && asNumber(finalized.number) > 0 && HASH.test(String(finalized.hash ?? ''))
  checks.push(check('finalized-anchor', finalizedOk ? STATUS.OK : STATUS.FAIL, finalizedOk ? 'finalized block/hash available' : 'finalized anchor unavailable', finalizedOk ? `${finalized.number}:${finalized.hash}` : undefined))

  const latestOk = latest && Number.isSafeInteger(asNumber(latest.number)) && asNumber(latest.number) > 0
  checks.push(check('latest-head', latestOk ? STATUS.OK : STATUS.FAIL, latestOk ? 'latest head available' : 'latest head unavailable', latestOk ? String(latest.number) : undefined))
  if (finalizedOk && latestOk) {
    checks.push(check('commitment-order', asNumber(latest.number) >= asNumber(finalized.number) ? STATUS.OK : STATUS.FAIL, 'latest height must not trail finalized height'))
  }

  for (const target of REQUIRED_MAINNET_CODE) {
    const value = code[target.id]
    checks.push(check(`code:${target.id}`, hasCode(value) ? STATUS.OK : STATUS.FAIL, hasCode(value) ? 'code present at finalized anchor' : 'missing code at finalized anchor', codeHashes[target.id]))
  }

  const oracleExpected = manifest?.systemEvent ?? {}
  const finalTs = asNumber(finalized?.timestamp ?? 0)
  const updatedAt = asNumber(oracle?.updatedAt ?? 0)
  const age = finalTs > 0 && updatedAt > 0 ? finalTs - updatedAt : Number.POSITIVE_INFINITY
  checks.push(check('oracle:description', oracle?.description === 'MON / USD' ? STATUS.OK : STATUS.FAIL, oracle?.description === 'MON / USD' ? 'feed description matches' : 'feed description mismatch', oracle?.description))
  checks.push(check('oracle:decimals', Number(oracle?.decimals) === 8 ? STATUS.OK : STATUS.FAIL, Number(oracle?.decimals) === 8 ? 'feed decimals match' : 'feed decimals mismatch', oracle?.decimals))
  checks.push(check('oracle:answer', BigInt(oracle?.answer ?? 0) > 0n ? STATUS.OK : STATUS.FAIL, BigInt(oracle?.answer ?? 0) > 0n ? 'positive feed answer' : 'feed answer is not positive', String(oracle?.answer ?? 0)))
  checks.push(check('oracle:round', BigInt(oracle?.answeredInRound ?? 0) >= BigInt(oracle?.roundId ?? 0) && BigInt(oracle?.roundId ?? 0) > 0n ? STATUS.OK : STATUS.FAIL, 'answeredInRound must cover roundId'))
  const oracleFresh = Number.isFinite(age) && age >= 0 && age <= Number(oracleExpected.maxAgeSeconds ?? 0)
  checks.push(check('oracle:freshness', oracleFresh ? STATUS.OK : STATUS.FAIL, oracleFresh ? `feed age ${age}s <= configured max ${oracleExpected.maxAgeSeconds}s` : `feed age ${Number.isFinite(age) ? age : 'unknown'}s exceeds/invalidates configured max ${oracleExpected.maxAgeSeconds ?? 0}s`, Number.isFinite(age) ? age : undefined))

  const seasonStart = Number(manifest?.seasonStart ?? 0)
  const leadSeconds = latestOk ? seasonStart - asNumber(latest.timestamp ?? 0) : Number.NaN
  if (!Number.isFinite(leadSeconds) || leadSeconds <= 0) {
    checks.push(check('season-start', STATUS.FAIL, 'seasonStart must still be in the future at preflight'))
  } else if (leadSeconds < 3600) {
    checks.push(check('season-start', STATUS.WARN, `season starts in only ${leadSeconds}s; deployment/add-on/acceptance work may consume the buffer`, leadSeconds))
  } else {
    checks.push(check('season-start', STATUS.OK, `season start lead ${leadSeconds}s`, leadSeconds))
  }

  const balance = BigInt(deployerBalanceWei ?? 0)
  checks.push(check('deployer-balance', balance > 0n ? STATUS.OK : STATUS.FAIL, balance > 0n ? 'deployer has MON balance; exact deployment affordability still depends on dry-run gas limits' : 'deployer balance is zero', formatEther(balance)))

  if (priorityFeeWei != null) {
    checks.push(check('priority-fee-suggestion', STATUS.WARN, 'RPC priority-fee suggestion is evidence only, not a launch policy or inclusion guarantee', String(priorityFeeWei)))
  }

  const summary = summarizePreflight(checks)
  return {
    schema: MAINNET_PREFLIGHT_SCHEMA,
    generatedAt: new Date().toISOString(),
    rpcUrlStored: false,
    manifestHash,
    chainId,
    finalized: finalized ? { number: String(finalized.number), hash: finalized.hash, timestamp: String(finalized.timestamp) } : null,
    latest: latest ? { number: String(latest.number), hash: latest.hash, timestamp: String(latest.timestamp), baseFeePerGas: latest.baseFeePerGas == null ? null : String(latest.baseFeePerGas) } : null,
    dependencies: Object.fromEntries(REQUIRED_MAINNET_CODE.map((target) => [target.id, {
      address: OFFICIAL_MAINNET[target.addressKey] ?? manifest?.[target.addressKey] ?? null,
      codeHash: codeHashes[target.id] ?? null,
      codePresent: hasCode(code[target.id]),
    }])),
    oracle: oracle ? {
      address: oracleExpected.monUsdFeed,
      description: oracle.description,
      decimals: Number(oracle.decimals),
      roundId: String(oracle.roundId),
      answer: String(oracle.answer),
      updatedAt: String(oracle.updatedAt),
      answeredInRound: String(oracle.answeredInRound),
      ageSecondsAtFinalized: Number.isFinite(age) ? age : null,
      configuredMaxAgeSeconds: Number(oracleExpected.maxAgeSeconds ?? 0),
    } : null,
    deployer: { address: manifest?.deployer, balanceWei: String(balance), balanceMon: formatEther(balance) },
    priorityFeeWei: priorityFeeWei == null ? null : String(priorityFeeWei),
    checks,
    summary,
    readyForDeploymentApproval: summary.FAIL === 0,
  }
}

export function formatPreflightText(result) {
  const lines = [
    '# r3OS mainnet preflight',
    '',
    'READ ONLY. A green preflight is not authorization to broadcast.',
    '',
    `manifest: ${result.manifestHash}`,
    `chain: ${result.chainId}`,
    `finalized: ${result.finalized?.number ?? 'n/a'} ${result.finalized?.hash ?? ''}`.trim(),
    `deployer balance: ${result.deployer.balanceMon} MON`,
    '',
  ]
  for (const item of result.checks) lines.push(`[${item.status}] ${item.id}: ${item.detail}${item.value === undefined ? '' : ` (${item.value})`}`)
  lines.push('', `result: ${result.readyForDeploymentApproval ? 'READY FOR HUMAN DEPLOYMENT APPROVAL' : 'BLOCKED'}`, '')
  return lines.join('\n')
}
