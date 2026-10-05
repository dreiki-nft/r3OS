import { describe, expect, it } from 'vitest'
import type { Hex } from 'viem'
import { canvasLogIdentity, reloadOnSpeculativeMismatch } from '../paint/canvasStore'
import { ProposalCommitmentTracker } from './speculation'

const A = `0x${'aa'.repeat(32)}` as Hex
const B = `0x${'bb'.repeat(32)}` as Hex
const A_HASH = `0x${'a1'.repeat(32)}` as Hex
const B_HASH = `0x${'b2'.repeat(32)}` as Hex
const TX = `0x${'cc'.repeat(32)}` as Hex

async function reconcileCanvas(applied: string[], canonical: string[], visible: { colour: string }) {
  return reloadOnSpeculativeMismatch(applied, canonical, async () => {
    visible.colour = 'blue'
  })
}

function paintIdentity(blockHash: Hex) {
  const identity = canvasLogIdentity({ blockHash, transactionHash: TX, logIndex: 0 })
  if (!identity) throw new Error('expected Paint log identity')
  return identity
}

describe('speculation integrity', () => {
  it('reconciles A Proposed / B Proposed / B Finalized so the canonical B canvas wins', async () => {
    const tracker = new ProposalCommitmentTracker()
    const visible = { colour: 'red' }

    tracker.observe({ blockId: A, blockNumber: 100n, commitState: 'Proposed', relevantActivity: true })
    tracker.observe({ blockId: B, blockNumber: 100n, commitState: 'Proposed', relevantActivity: true })
    // Hostile delivery order: A was rendered last, so the speculative UI currently shows red.
    visible.colour = 'red'

    const decision = tracker.observe({
      blockId: B,
      blockNumber: 100n,
      commitState: 'Finalized',
      relevantActivity: true,
    })
    expect(decision.shouldReconcile).toBe(true)
    expect(decision.supersededBlockIds).toEqual([A])

    // Same tx/log coordinates under sibling block hashes must compare as different observations.
    await expect(reconcileCanvas([paintIdentity(A_HASH)], [paintIdentity(B_HASH)], visible)).resolves.toBe(true)
    expect(visible.colour).toBe('blue')
  })

  it('handles A Proposed → A Voted → B Proposed → B Finalized', () => {
    const tracker = new ProposalCommitmentTracker()
    expect(
      tracker.observe({ blockId: A, blockNumber: 200n, commitState: 'Proposed', relevantActivity: true })
        .shouldReconcile,
    ).toBe(false)
    expect(
      tracker.observe({ blockId: A, blockNumber: 200n, commitState: 'Voted', relevantActivity: true })
        .shouldReconcile,
    ).toBe(false)
    expect(
      tracker.observe({ blockId: B, blockNumber: 200n, commitState: 'Proposed', relevantActivity: true })
        .shouldReconcile,
    ).toBe(false)

    const decision = tracker.observe({
      blockId: B,
      blockNumber: 200n,
      commitState: 'Finalized',
      relevantActivity: true,
    })
    expect(decision.shouldReconcile).toBe(true)
    expect(decision.finalizedBlockId).toBe(B)
    expect(decision.supersededBlockIds).toEqual([A])
  })

  it('does not manufacture a reorg for A Proposed → Voted → Finalized → Verified', () => {
    const tracker = new ProposalCommitmentTracker()
    for (const state of ['Proposed', 'Voted', 'Finalized', 'Verified'] as const) {
      const decision = tracker.observe({ blockId: A, blockNumber: 300n, commitState: state, relevantActivity: true })
      expect(decision.shouldReconcile).toBe(false)
      expect(decision.supersededBlockIds).toEqual([])
    }
  })

  it('is idempotent when the same Finalized update is delivered more than once', () => {
    const tracker = new ProposalCommitmentTracker()
    tracker.observe({ blockId: A, blockNumber: 400n, commitState: 'Proposed', relevantActivity: true })
    tracker.observe({ blockId: B, blockNumber: 400n, commitState: 'Proposed', relevantActivity: true })
    expect(
      tracker.observe({ blockId: B, blockNumber: 400n, commitState: 'Finalized', relevantActivity: true })
        .shouldReconcile,
    ).toBe(true)
    expect(
      tracker.observe({ blockId: B, blockNumber: 400n, commitState: 'Finalized', relevantActivity: true })
        .shouldReconcile,
    ).toBe(false)
  })
})
