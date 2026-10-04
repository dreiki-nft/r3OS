import type { Hex } from 'viem'

export interface LastPaint {
  block: bigint
  hash?: Hex
  /** ms from the RPC accepting the transaction to this app seeing its receipt; undefined if not measured */
  receiptMs?: number
}

/** "included in block #123 · receipt in 0.6 s": only the parts this app actually observed. */
export function paintedText(paint: LastPaint) {
  const base = `included in block #${paint.block}`
  if (paint.receiptMs == null || !Number.isFinite(paint.receiptMs) || paint.receiptMs < 0) return base
  return `${base} · receipt in ${(paint.receiptMs / 1_000).toFixed(1)} s`
}
