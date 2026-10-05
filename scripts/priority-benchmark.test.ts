import { describe, expect, it } from 'vitest'
import { PRIORITY_CONFIRM, assertSendGate, buildPriorityPlan } from './priority-benchmark-lib.mjs'

describe('priority benchmark safety', () => {
  it('builds the requested 0/1/2/5 gwei matrix with exact 21k gas envelopes', () => {
    const rows = buildPriorityPlan(100_000_000_000n, [0, 1, 2, 5])
    expect(rows.map((row) => row.priorityGwei)).toEqual([0, 1, 2, 5])
    expect(rows.every((row) => row.gasLimit === 21_000n)).toBe(true)
    expect(rows[2].maxFeePerGas).toBe(202_000_000_000n)
  })

  it('is read-only by default and requires exact mainnet spend confirmation to send', () => {
    expect(() => assertSendGate({ send: false, chainId: 143, confirmation: undefined })).not.toThrow()
    expect(() => assertSendGate({ send: true, chainId: 10143, confirmation: PRIORITY_CONFIRM })).toThrow(
      'PRIORITY_BENCH_MAINNET_ONLY',
    )
    expect(() => assertSendGate({ send: true, chainId: 143, confirmation: 'yes' })).toThrow(
      'PRIORITY_BENCH_EXPLICIT_CONFIRMATION_REQUIRED',
    )
    expect(() => assertSendGate({ send: true, chainId: 143, confirmation: PRIORITY_CONFIRM })).not.toThrow()
  })
})
