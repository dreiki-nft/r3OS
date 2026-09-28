import { formatEther } from 'viem'

// docs/specs/GAS_LIMITS.md. Re-measure all limits on testnet in Phase 5.
export const CORRUPTION_WRITE_GAS = 12_000n
export const FLIPBOOK_PAINT_GAS_LIMIT = 240_000n
export const FORK_PAINT_GAS_LIMIT = 250_000n

export type GasKind = 'corePaint' | 'paintAndMintFrame' | 'flipbookPaint' | 'forkPaint' | 'estimate'

export function corruptionKMax(pixels: number) {
  return Math.min(32, Math.floor(pixels * 0.0198) + 1)
}
export function withTenPercent(value: bigint) {
  return (value * 110n + 99n) / 100n
}
export function gasLimitFor(kind: GasKind, estimate: bigint, pixels = 0) {
  if (kind === 'flipbookPaint') return FLIPBOOK_PAINT_GAS_LIMIT
  if (kind === 'forkPaint') return FORK_PAINT_GAS_LIMIT
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
