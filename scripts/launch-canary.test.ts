import { describe, expect, it } from 'vitest'
import {
  MAINNET_CANARY_SCHEMA,
  assessFinalizedAgreement,
  decodeMonadCommit,
  doctorDigest,
  parseCanaryArgs,
  validateMainnetCanary,
} from './launch-canary-lib.mjs'

const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`

function greenCanary() {
  return {
    schema: MAINNET_CANARY_SCHEMA,
    mode: 'transaction',
    readOnly: false,
    chainId: 143,
    providers: {
      primary: { evidenceHash: hash(1) },
      secondary: { evidenceHash: hash(1) },
    },
    splitBrain: { status: 'OK', sharedBlockNumber: '100', sharedBlockHash: hash(100) },
    operationalReads: { budgetMatch: true, canaryHourlyBudgetSufficient: true, partnerBudgetMatch: true, passPointerMatch: true, pageMatch: true, primary: { pageHash: hash(55) } },
    websocket: { connected: true, newHeadObserved: true, monadLogsSubscribed: true },
    transaction: {
      executed: true,
      hash: hash(9),
      receiptStatus: 'success',
      paintEventObserved: true,
      proposedObserved: true,
      votedObserved: true,
      finalizedObserved: true,
      primaryFinalized: true,
      secondaryFinalized: true,
      secondProviderReceipt: true,
      secondProviderCanonicalBlock: true,
      visualStateRestored: true,
    },
    summary: { OK: 14, WARN: 0, FAIL: 0 },
    exitCode: 0,
  }
}

describe('Phase 9D mainnet canary', () => {
  it('accepts provider lag when both providers agree at the shared finalized height', () => {
    const result = assessFinalizedAgreement(
      { chainId: 143, height: 105n },
      { chainId: 143, height: 103n },
      { number: 103n, hash: hash(103) },
      { number: 103n, hash: hash(103) },
    )
    expect(result).toMatchObject({ status: 'OK', sharedBlockNumber: '103', finalizedHeightSkew: '2' })
  })

  it('fails closed on a shared finalized hash disagreement', () => {
    const result = assessFinalizedAgreement(
      { chainId: 143, height: 105n },
      { chainId: 143, height: 105n },
      { number: 105n, hash: hash(1) },
      { number: 105n, hash: hash(2) },
    )
    expect(result.status).toBe('FAIL')
    expect(result.errors).toContain('providers disagree on the shared finalized block hash')
  })

  it('decodes nested monadLogs commit-state notifications', () => {
    expect(decodeMonadCommit({ params: { result: { data: { commitState: 'Finalized', transactionHash: hash(7), blockNumber: '0x2a' } } } })).toEqual({
      commitState: 'Finalized',
      transactionHash: hash(7),
      blockNumber: '0x2a',
    })
  })

  it('hashes stable doctor evidence independently of key insertion order', () => {
    const a = { evidence: { contracts: { A: { address: '0x1' } }, registry: [], renderers: [], ownership: {}, partners: {}, configuration: {}, freezeStates: {} } }
    const b = { evidence: { freezeStates: {}, configuration: {}, partners: {}, ownership: {}, renderers: [], registry: [], contracts: { A: { address: '0x1' } } } }
    expect(doctorDigest(a)).toBe(doctorDigest(b))
  })

  it('requires the real transaction path for genesis-grade canary evidence', () => {
    expect(validateMainnetCanary(greenCanary(), { requireTransaction: true })).toEqual([])
    const bad = greenCanary()
    bad.mode = 'read-only'
    bad.transaction.executed = false
    bad.transaction.finalizedObserved = false
    expect(validateMainnetCanary(bad, { requireTransaction: true })).toEqual(expect.arrayContaining([
      'mainnet canary transaction mode is required',
      'mainnet canary transaction evidence is required',
    ]))
  })

  it('fails closed when the canary painter has fewer than two hourly units available', () => {
    const bad = greenCanary()
    bad.operationalReads.canaryHourlyBudgetSufficient = false
    expect(validateMainnetCanary(bad, { requireTransaction: true })).toContain(
      'mainnet canary painter must have at least 2 hourly units available on both providers',
    )
  })

  it('parses endpoint env fallbacks without needing them on argv', () => {
    const parsed = parseCanaryArgs(['--json'], {
      RPC_URL: 'https://primary.invalid',
      RPC_URL_SECONDARY: 'https://secondary.invalid',
      WS_URL: 'wss://ws.invalid',
      PAINT_ADDRESS: '0x0000000000000000000000000000000000000001',
      FINAL_OWNER: '0x0000000000000000000000000000000000000002',
      EXPECTED_CHAIN_ID: '143',
    })
    expect(parsed).toMatchObject({ json: true, expectedChain: 143, primaryRpc: 'https://primary.invalid', secondaryRpc: 'https://secondary.invalid' })
  })
})
