import { formatUnits, parseUnits, type Address, type Hex } from 'viem'

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

export const MONOPER_ADDRESS = '0x2fC920B040CacA7E94630dAC208394C8e6cd1408' as Address
export const MONOPER_CODE_HASH = '0xfbbbbcd1653419f58aee3b1e86a781f7c4d5bc0ce1a4868c8cfc98a97821aab5' as Hex
export const MONOPER_MANIFEST_COMMIT = '739f26c'

export const MAINNET_TOKENS = {
  WMON: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A' as Address,
  USDC: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603' as Address,
  WETH: '0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242' as Address,
  WBTC: '0x0555e30da8f98308edb960aa94c0db47230d2b9c' as Address,
  cbBTC: '0xd18b7ec58cdf4876f6afebd3ed1730e4ce10414b' as Address,
} as const

const SOURCE = `Monoper deployment manifest @ ${MONOPER_MANIFEST_COMMIT}`

export const MAINNET_VENUES: readonly RouterVenue[] = [
  {
    label: 'poe-mon-usdc',
    adapter: '0xa13FEdc8f6Ae3b197F0aF0eF34a3E6F08fd999E1',
    token0: MAINNET_TOKENS.WMON,
    token1: MAINNET_TOKENS.USDC,
    expectedCodeHash: '0xa4372be09d0fe3ad470d5a9986841bf2ead48a3d7068c84297fae22716925148',
    source: SOURCE,
  },
  {
    label: 'clober-mon-usdc',
    adapter: '0x438e3C0F7C66e8B4d788C743559D5076226A96D2',
    token0: MAINNET_TOKENS.WMON,
    token1: MAINNET_TOKENS.USDC,
    expectedCodeHash: '0x90c7b5cf315562ba81ed40559e0391ce2efe07796205486ea70a0b3963d4c927',
    source: SOURCE,
  },
  {
    label: 'metric-mon-usdc',
    adapter: '0x63f951E2C726215a719aC4d8F7Ad6B1cA9dcAd3B',
    token0: MAINNET_TOKENS.WMON,
    token1: MAINNET_TOKENS.USDC,
    expectedCodeHash: '0x9ca7cec898e31cf9ffc6d1bb88aa53409e7c5ccdde8a4bbf2e8af9f24bdef33b',
    source: SOURCE,
  },
  {
    label: 'hanji-mon-usdc',
    adapter: '0xFAAE283A98274a6c788dcBb66760EC4B76c48EB6',
    token0: MAINNET_TOKENS.WMON,
    token1: MAINNET_TOKENS.USDC,
    expectedCodeHash: '0x0b502bff967d1f4b0e7eca5f82bf007ba9a1027105ae3481c56761090d4cc497',
    source: SOURCE,
  },
  {
    label: 'thog-mon-usdc',
    adapter: '0x7c87E2dFD32BDeEa11654866F5199E3aC9CC92eB',
    token0: MAINNET_TOKENS.WMON,
    token1: MAINNET_TOKENS.USDC,
    expectedCodeHash: '0xdcb04f597fcd089b13ca2fe213defc963d776c4fde428af3e99092ddd900906f',
    source: SOURCE,
  },
  {
    label: 'clober-weth-usdc',
    adapter: '0xb465A460b40A35CBB422Ef8f442AD3Fe75A884Fb',
    token0: MAINNET_TOKENS.WETH,
    token1: MAINNET_TOKENS.USDC,
    expectedCodeHash: '0x56f025c7ec5d76c0eec1c6cbb7c37e1a4ec0e06baab38689b5b25fb14735bb8a',
    source: SOURCE,
  },
  {
    label: 'metric-weth-usdc',
    adapter: '0x1925562a8FAFF1559C739965978045a3D3C5e2Fa',
    token0: MAINNET_TOKENS.WETH,
    token1: MAINNET_TOKENS.USDC,
    expectedCodeHash: '0xa117cb8b1b7a4b92de87d53f0fef062267776c2f943a9e4460e2ce52f033d432',
    source: SOURCE,
  },
  {
    label: 'hanji-weth-usdc',
    adapter: '0x6F34F44D8B166F7EaC3fBaF9882a725F67C36f84',
    token0: MAINNET_TOKENS.WETH,
    token1: MAINNET_TOKENS.USDC,
    expectedCodeHash: '0xa39130853f18e9d595a720b9a99bc1e7994a217c98fb3b6fcd0b7df72ddb9dde',
    source: SOURCE,
  },
  {
    label: 'clober-wbtc-usdc',
    adapter: '0x8ec90365d48Fde3dF780ad54326e555B897beF1a',
    token0: MAINNET_TOKENS.WBTC,
    token1: MAINNET_TOKENS.USDC,
    expectedCodeHash: '0x89e8663049e696422f7c342d6867deb19a50944fd5f784ceb8593fa837dc7898',
    source: SOURCE,
  },
  {
    label: 'metric-wbtc-usdc',
    adapter: '0xf4CD6a9f68BF052e3E90f8Bab304e75d374993aA',
    token0: MAINNET_TOKENS.WBTC,
    token1: MAINNET_TOKENS.USDC,
    expectedCodeHash: '0x1f7fbb960a237e87e6f5f247621bf2c5d3f37123a3bc606b9607ad0d861d1311',
    source: SOURCE,
  },
  {
    label: 'hanji-cbbtc-usdc',
    adapter: '0xB565572277898dA8E4aFfF88FBfC79d9Bd57c9c3',
    token0: MAINNET_TOKENS.cbBTC,
    token1: MAINNET_TOKENS.USDC,
    expectedCodeHash: '0x231c703bf3a8cba001b1f7ff3e6f8e13205c6c3701f95fd76941f9a610891f78',
    source: SOURCE,
  },
  {
    label: 'hanji-mon-weth',
    adapter: '0x624E92EfA1D6A2A6ce3625B9a6480C3EbE52643C',
    token0: MAINNET_TOKENS.WMON,
    token1: MAINNET_TOKENS.WETH,
    expectedCodeHash: '0x0205a8a5214fff33d411b968bfb62929a76402e33bb1ed4720d09e9f0c55b33a',
    source: SOURCE,
  },
  {
    label: 'hanji-cbbtc-mon',
    adapter: '0xb84baD3443e59bde160E3EB4a6ae1087a6a444B5',
    token0: MAINNET_TOKENS.cbBTC,
    token1: MAINNET_TOKENS.WMON,
    expectedCodeHash: '0xc93c632ac236dd3499318cd3fd27a867b2e0a13a67ee80f8ca465c31c3405d1a',
    source: SOURCE,
  },
  {
    label: 'hanji-cbbtc-weth',
    adapter: '0xB0262e43A36C4Fc1B38d47B623d22c327523b705',
    token0: MAINNET_TOKENS.cbBTC,
    token1: MAINNET_TOKENS.WETH,
    expectedCodeHash: '0xf531cbcc8b2774a4c5cd5eac9a39cce4b16cbf6722d8b3585166a5c4159bc66c',
    source: SOURCE,
  },
]

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
