/**
 * Ordinary read RPCs must fail over quickly enough that one degraded provider cannot own the UI.
 * These are deliberately separate from the action-RPC lane, which has its own tighter policy.
 */
export const PUBLIC_RPC_TIMEOUT_MS = 2_500
export const PUBLIC_RPC_RETRY_COUNT = 0
export const PUBLIC_RPC_RANK_INTERVAL_MS = 30_000
export const PUBLIC_RPC_RANK_TIMEOUT_MS = 800
export const PUBLIC_RPC_RANK_SAMPLE_COUNT = 5
export const PUBLIC_RPC_RANK_WEIGHTS = { latency: 0.65, stability: 0.35 } as const

export function publicRpcWorstCaseSingleEndpointMs() {
  return PUBLIC_RPC_TIMEOUT_MS * (PUBLIC_RPC_RETRY_COUNT + 1)
}
