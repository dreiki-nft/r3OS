/**
 * "Need MON?" for Paint: say plainly when a wallet can't pay for the next stroke, or soon won't, using the
 * stroke's real quote (Monad charges the gas limit, so the quoted max is close to what a stroke costs).
 * Never shows a price it doesn't have; never names an exchange.
 */
import { formatEther } from 'viem'

export type GasHint =
  | { kind: 'empty'; network: 'testnet' | 'mainnet'; perStroke?: string }
  | { kind: 'short'; perStroke: string; balance: string }
  | { kind: 'low'; strokes: number; perStroke: string }

/** Below this many strokes left, warn before the wallet runs dry mid-party. */
export const LOW_STROKES = 10

export function formatMon(wei: bigint) {
  const value = Number(formatEther(wei))
  if (value === 0) return '0 MON'
  if (value >= 1) return `${value.toFixed(2)} MON`
  // Small amounts: keep 2 significant digits so 0.0042 doesn't round to 0.00.
  return `${Number(value.toPrecision(2))} MON`
}

export function gasHint(input: {
  balance?: bigint
  /** wei the next stroke can cost (gas limit × max fee), from the latest paint quote */
  strokeCost?: bigint
  chainId: number
}): GasHint | undefined {
  const { balance, strokeCost, chainId } = input
  if (balance == null) return undefined
  const perStroke = strokeCost && strokeCost > 0n ? formatMon(strokeCost) : undefined
  if (balance === 0n) return { kind: 'empty', network: chainId === 10143 ? 'testnet' : 'mainnet', perStroke }
  if (!strokeCost || strokeCost <= 0n) return undefined
  if (balance < strokeCost) return { kind: 'short', perStroke: perStroke!, balance: formatMon(balance) }
  const strokes = Number(balance / strokeCost)
  if (strokes < LOW_STROKES) return { kind: 'low', strokes, perStroke: perStroke! }
  return undefined
}
