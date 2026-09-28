import type { Hex } from 'viem'

export type TxSigner = 'wallet' | 'burner'
export type CommitState = 'Proposed' | 'Voted' | 'Finalized' | 'Verified'

export interface TxTrace {
  hash: Hex
  action: string
  signer: TxSigner
  regions: number[]
  gasLimit: bigint
  maxFeePerGas: bigint
  t: {
    signed?: number
    sent: number
    proposed?: number
    voted?: number
    finalized?: number
  }
  blockNumber?: bigint
  gasUsed?: bigint
  effectiveGasPrice?: bigint
}

type Listener = () => void

type TraceSnapshot = {
  version: number
  traces: readonly TxTrace[]
}

const listeners = new Set<Listener>()
const pendingCommits = new Map<Hex, { state: CommitState; blockNumber?: bigint; at: number }[]>()
let snapshot: TraceSnapshot = { version: 0, traces: [] }

function emit(traces: readonly TxTrace[]) {
  snapshot = { version: snapshot.version + 1, traces }
  for (const listener of listeners) listener()
}

function stamp() {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

export function subscribeTxTrace(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getTxTraceSnapshot() {
  return snapshot
}

export function recordTxTrace(trace: TxTrace) {
  emit([trace, ...snapshot.traces.filter((item) => item.hash !== trace.hash)].slice(0, 20))
  const pending = pendingCommits.get(trace.hash)
  if (pending) {
    pendingCommits.delete(trace.hash)
    for (const item of pending) markTraceCommit(trace.hash, item.state, item.blockNumber, item.at)
  }
}

export function updateTxTrace(hash: Hex, update: (trace: TxTrace) => TxTrace) {
  let changed = false
  const traces = snapshot.traces.map((trace) => {
    if (trace.hash !== hash) return trace
    changed = true
    return update(trace)
  })
  if (changed) emit(traces)
  return changed
}

export function markTraceCommit(hash: Hex, state: CommitState, blockNumber?: bigint, at = stamp()) {
  if (state === 'Verified') return
  if (!snapshot.traces.some((trace) => trace.hash === hash)) {
    const pending = pendingCommits.get(hash) ?? []
    pending.push({ state, blockNumber, at })
    pendingCommits.set(hash, pending.slice(-4))
    return
  }
  updateTxTrace(hash, (trace) => {
    if (state === 'Proposed' && trace.t.proposed == null) {
      return { ...trace, blockNumber: blockNumber ?? trace.blockNumber, t: { ...trace.t, proposed: at } }
    }
    if (state === 'Voted' && trace.t.voted == null) {
      return { ...trace, blockNumber: blockNumber ?? trace.blockNumber, t: { ...trace.t, voted: at } }
    }
    if (state === 'Finalized' && trace.t.finalized == null) {
      return { ...trace, blockNumber: blockNumber ?? trace.blockNumber, t: { ...trace.t, finalized: at } }
    }
    return trace
  })
}

export function markTraceProposedFromPlainLog(hash: Hex, blockNumber: bigint, at = stamp()) {
  markTraceCommit(hash, 'Proposed', blockNumber, at)
}

export function markTraceReceipt(
  hash: Hex,
  receipt: { blockNumber: bigint; gasUsed: bigint; effectiveGasPrice: bigint },
  at = stamp(),
) {
  updateTxTrace(hash, (trace) => ({
    ...trace,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    effectiveGasPrice: receipt.effectiveGasPrice,
    t: { ...trace.t, finalized: trace.t.finalized ?? at },
  }))
}

export function __resetTxTraceForTests() {
  snapshot = { version: 0, traces: [] }
  pendingCommits.clear()
}
