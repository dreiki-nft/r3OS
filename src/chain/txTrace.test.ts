import { beforeEach, describe, expect, it } from 'vitest'
import type { Hex } from 'viem'
import {
  __resetTxTraceForTests,
  getTxTraceSnapshot,
  markTraceCommit,
  markTraceReceipt,
  recordTxTrace,
} from './txTrace'

const hash = `0x${'11'.repeat(32)}` as Hex

describe('transaction trace', () => {
  beforeEach(__resetTxTraceForTests)

  it('records Proposed, Voted and Finalized times once', () => {
    recordTxTrace({
      hash,
      action: 'paint 38 px',
      signer: 'burner',
      regions: [1],
      gasLimit: 100n,
      maxFeePerGas: 2n,
      t: { signed: 1, sent: 2 },
    })
    markTraceCommit(hash, 'Proposed', 10n, 3)
    markTraceCommit(hash, 'Voted', 10n, 4)
    markTraceCommit(hash, 'Finalized', 10n, 5)
    expect(getTxTraceSnapshot().traces[0].t).toEqual({
      signed: 1,
      sent: 2,
      proposed: 3,
      voted: 4,
      finalized: 5,
    })
  })

  it('records receipt inclusion without pretending it is a Finalized signal', () => {
    recordTxTrace({
      hash,
      action: 'save frame',
      signer: 'wallet',
      regions: [],
      gasLimit: 100n,
      maxFeePerGas: 2n,
      t: { sent: 2 },
    })
    markTraceCommit(hash, 'Proposed', 10n, 3)
    markTraceReceipt(hash, { blockNumber: 10n, gasUsed: 80n, effectiveGasPrice: 2n }, 6)
    const trace = getTxTraceSnapshot().traces[0]
    expect(trace.t.voted).toBeUndefined()
    expect(trace.t.receipt).toBe(6)
    expect(trace.t.finalized).toBeUndefined()
    expect(trace.gasUsed).toBe(80n)
  })

  it('keeps an early Proposed notification until the trace is recorded', () => {
    markTraceCommit(hash, 'Proposed', 10n, 3)
    recordTxTrace({
      hash,
      action: 'paint 12 px',
      signer: 'burner',
      regions: [0],
      gasLimit: 100n,
      maxFeePerGas: 2n,
      t: { signed: 1, sent: 2 },
    })
    expect(getTxTraceSnapshot().traces[0].t.proposed).toBe(3)
  })
})
