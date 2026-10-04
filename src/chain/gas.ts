import { formatEther } from 'viem'

// Core Paint writes may fan out through DF1 corruption. Keep deterministic headroom on top of the RPC estimate.
export const CORRUPTION_WRITE_GAS = 12_000n

export type GasKind = 'corePaint' | 'paintAndMintFrame' | 'estimate'

export function corruptionKMax(pixels: number) {
  return Math.min(32, Math.floor(pixels * 0.0198) + 1)
}
export function withTenPercent(value: bigint) {
  return (value * 110n + 99n) / 100n
}
export function gasLimitFor(kind: GasKind, estimate: bigint, pixels = 0) {
  if (kind === 'corePaint' || kind === 'paintAndMintFrame') {
    return withTenPercent(estimate + BigInt(corruptionKMax(pixels)) * CORRUPTION_WRITE_GAS)
  }
  return withTenPercent(estimate)
}
export function maxCostWei(gasLimit: bigint, maxFeePerGas: bigint) {
  return gasLimit * maxFeePerGas
}
export function formatMaxCost(gasLimit: bigint, maxFeePerGas: bigint) {
  return `${Number(formatEther(maxCostWei(gasLimit, maxFeePerGas))).toFixed(6)} MON max`
}
