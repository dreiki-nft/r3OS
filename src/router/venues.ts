import { formatUnits, parseUnits, type Address, type Hex } from 'viem'
import manifest from './mainnet-venues.json'

export interface RouterVenue {
  label: string
  adapter: Address
  token0: Address
  token1: Address
  expectedCodeHash?: Hex
  source: string
  mock?: boolean
}

export interface RouterToken {
  address: Address
  symbol?: string
  decimals?: number
}

/**
 * Mainnet venue manifest. The data lives in `mainnet-venues.json` so the browser app and the Node
 * Launch Doctor (`scripts/launch-doctor.mjs`) check the exact same adapters and runtime-code hashes.
 */
type TokenSymbol = keyof typeof manifest.tokens

export const MONOPER_ADDRESS = manifest.monoper.address as Address
export const MONOPER_CODE_HASH = manifest.monoper.codeHash as Hex
export const MONOPER_MANIFEST_COMMIT = manifest.manifestCommit

export const MAINNET_TOKENS = manifest.tokens as { readonly [K in TokenSymbol]: Address }

const SOURCE = `Monoper deployment manifest @ ${MONOPER_MANIFEST_COMMIT}`

export const MAINNET_VENUES: readonly RouterVenue[] = manifest.venues.map((venue) => ({
  label: venue.label,
  adapter: venue.adapter as Address,
  token0: MAINNET_TOKENS[venue.token0 as TokenSymbol],
  token1: MAINNET_TOKENS[venue.token1 as TokenSymbol],
  expectedCodeHash: venue.expectedCodeHash as Hex,
  source: SOURCE,
}))

function same(a: Address, b: Address) {
  return a.toLowerCase() === b.toLowerCase()
}

export function pairKey(a: Address, b: Address) {
  return [a.toLowerCase(), b.toLowerCase()].sort().join(':')
}

export function pairsFor(
  chainId: number,
  venues: readonly RouterVenue[] = chainId === 143 ? MAINNET_VENUES : [],
) {
  const seen = new Set<string>()
  const pairs: { token0: Address; token1: Address }[] = []
  for (const venue of venues) {
    const key = pairKey(venue.token0, venue.token1)
    if (seen.has(key)) continue
    seen.add(key)
    pairs.push({ token0: venue.token0, token1: venue.token1 })
  }
  return pairs
}

export function venuesForPair(
  tokenIn: Address,
  tokenOut: Address,
  venues: readonly RouterVenue[] = MAINNET_VENUES,
) {
  return venues.filter(
    (venue) =>
      (same(venue.token0, tokenIn) && same(venue.token1, tokenOut)) ||
      (same(venue.token1, tokenIn) && same(venue.token0, tokenOut)),
  )
}

export function parseAmount(text: string, decimals: number) {
  const value = text.trim()
  if (!value || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error('invalid amount')
  if ((value.split('.')[1]?.length ?? 0) > decimals) throw new Error(`too many decimals (max ${decimals})`)
  const parsed = parseUnits(value, decimals)
  if (parsed <= 0n) throw new Error('amount must be greater than zero')
  return parsed
}

export function formatAmount(value: bigint, decimals: number, maxFraction = 6) {
  const raw = formatUnits(value, decimals)
  const [whole, fraction = ''] = raw.split('.')
  const clipped = fraction.slice(0, maxFraction).replace(/0+$/, '')
  return clipped ? `${whole}.${clipped}` : whole
}

export function bpsDelta(value: bigint, top: bigint) {
  if (top === 0n) return 0n
  return ((value - top) * 1_000_000n) / top
}

export type CodeHashState = 'match' | 'differs' | 'no-code' | 'unknown'

export function classifyCodeHash(codeHash?: Hex, expected?: Hex, hasCode = true): CodeHashState {
  if (!hasCode) return 'no-code'
  if (!codeHash || !expected) return 'unknown'
  return codeHash.toLowerCase() === expected.toLowerCase() ? 'match' : 'differs'
}

export const ROUTER_STATUS = [
  'OK',
  'ZERO OUTPUT',
  'MALFORMED',
  'OVERSIZED',
  'REVERTED',
  'REVERTED AT GAS CAP',
  'NO CODE',
  'FRAME ERROR',
] as const

export function statusLabel(status: number) {
  return ROUTER_STATUS[status] ?? 'UNKNOWN'
}
