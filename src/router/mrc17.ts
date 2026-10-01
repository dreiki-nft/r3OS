import { parseAbi, toFunctionSelector, type Hex } from 'viem'

export const MRC17_MIP_COMMIT = '6e4f86333923f0c4ec77bc92b3702f1b21f37446'
export const MRC17_ADAPTERS_COMMIT = '2f1400d17c262cec6c4860a99916accf7f3044d8'
export const MRC17_LABEL = 'MRC-17 DRAFT'

export const MRC17_ABI = parseAbi([
  'function getAmountOut(address tokenIn,address tokenOut,uint256 amountIn,bytes quoteData) returns (uint256 amountOut,bytes swapData)',
  'function swap(address tokenIn,address tokenOut,address to,uint256 amountIn,uint256 amountOutMin,uint256 deadline,bytes swapData) returns (uint256 amountOut)',
])

export const ERC20_METADATA_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
])

export const MONOPER_ABI = parseAbi([
  'function quote((uint256 algorithmId,bytes algorithmData,address tokenIn,address tokenOut,uint256 amountIn,(address adapter,bytes quoteData)[] candidates) params) returns ((uint256 amountOut,bytes resultData) result)',
])

export const MOCK_DIRECTORY_ABI = parseAbi([
  'function venues() view returns (address[] adapters,string[] labels,address token0,address token1)',
  'function tokens() view returns (address wrappedNative,address usd)',
])

const KNOWN_ERRORS = [
  ['InvalidTokenPair()', 'pair/direction not served'],
  ['IncompleteFill()', 'complete input not fillable at current depth (Clober)'],
  ['InsufficientHelperDepth()', 'ladder depth insufficient (Hanji)'],
  ['InvalidShareAmount()', 'input not a whole share amount (Hanji)'],
  [
    'FeedStalled()',
    'venue price feed stalled (Metric price provider; name from the public signature database)',
  ],
  ['InvalidQuote()', 'adapter rejected the quote'],
  ['QuoteAmountOverflow()', 'quoted amount exceeds adapter bounds'],
  ['UnexpectedData()', 'adapter rejected unexpected quote data'],
  ['InsufficientLiquidity()', 'mock venue has insufficient liquidity'],
] as const

export const ADAPTER_ERROR_TABLE = new Map<Hex, { name: string; meaning: string }>(
  KNOWN_ERRORS.map(([signature, meaning]) => [
    toFunctionSelector(signature) as Hex,
    { name: signature.slice(0, signature.indexOf('(')), meaning },
  ]),
)

export type AdapterError = { selector: Hex; adapterSpecific: boolean; name?: string; meaning?: string }

export function decodeAdapterError(selector?: Hex | string): AdapterError | undefined {
  if (!selector || selector === '0x00000000') return undefined
  const normalized = selector.toLowerCase() as Hex
  const known = [...ADAPTER_ERROR_TABLE.entries()].find(([key]) => key.toLowerCase() === normalized)
  return known
    ? { selector: normalized, ...known[1], adapterSpecific: true }
    : { selector: normalized, adapterSpecific: false }
}
