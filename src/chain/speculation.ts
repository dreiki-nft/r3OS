import type { Hex } from 'viem'
import type { CommitState } from './txTrace'

const RANK: Record<CommitState, number> = {
  Proposed: 0,
  Voted: 1,
  Finalized: 2,
  Verified: 3,
}

interface ProposalState {
  state: CommitState
  relevantActivity: boolean
}

interface HeightState {
  proposals: Map<Hex, ProposalState>
  finalized?: Hex
  reconciledFinalized?: Hex
}

export interface CommitmentObservation {
  blockId?: Hex
  blockNumber?: bigint
  commitState: CommitState
  relevantActivity?: boolean
}

export interface CommitmentDecision {
  blockNumber?: bigint
  finalizedBlockId?: Hex
  supersededBlockIds: readonly Hex[]
  shouldReconcile: boolean
}

/**
 * Tracks Monad proposal identity independently from transaction receipts/log identity.
 *
 * Monad can expose more than one proposal at the same height. There is no explicit
 * abandonment notification for a losing proposal, so a different blockId becoming
 * Finalized is the signal that any speculative state from its siblings must be
 * reconciled against canonical/finalized chain state.
 */
export class ProposalCommitmentTracker {
  private readonly heights = new Map<bigint, HeightState>()

  constructor(private readonly maxHeights = 96) {}

  observe(observation: CommitmentObservation): CommitmentDecision {
    const { blockId, blockNumber, commitState } = observation
    if (!blockId || blockNumber == null) {
      return { blockNumber, supersededBlockIds: [], shouldReconcile: false }
    }

    let height = this.heights.get(blockNumber)
    if (!height) {
      height = { proposals: new Map() }
      this.heights.set(blockNumber, height)
    }

    const previous = height.proposals.get(blockId)
    const nextState = previous && RANK[previous.state] > RANK[commitState] ? previous.state : commitState
    height.proposals.set(blockId, {
      state: nextState,
      relevantActivity: Boolean(previous?.relevantActivity || observation.relevantActivity),
    })

    let supersededBlockIds: Hex[] = []
    let shouldReconcile = false

    if (commitState === 'Finalized' || commitState === 'Verified') {
      const priorWinner = height.finalized
      height.finalized = blockId

      supersededBlockIds = [...height.proposals.entries()]
        .filter(([candidate, state]) => candidate !== blockId && state.relevantActivity)
        .map(([candidate]) => candidate)

      const winnerChanged = Boolean(priorWinner && priorWinner !== blockId)
      const hasRelevantLosingProposal = supersededBlockIds.length > 0
      const alreadyReconciled = height.reconciledFinalized === blockId
      shouldReconcile = !alreadyReconciled && (winnerChanged || hasRelevantLosingProposal)
      if (shouldReconcile) height.reconciledFinalized = blockId
    }

    this.prune()
    return {
      blockNumber,
      finalizedBlockId: height.finalized,
      supersededBlockIds,
      shouldReconcile,
    }
  }

  reset() {
    this.heights.clear()
  }

  private prune() {
    while (this.heights.size > this.maxHeights) {
      const oldest = this.heights.keys().next().value as bigint | undefined
      if (oldest == null) return
      this.heights.delete(oldest)
    }
  }
}
