import {
  decodeAbiParameters,
  decodeErrorResult,
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  type Address,
  type Hex,
} from 'viem'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { discoverContracts } from '../chain/contracts'
import { readMany } from '../chain/readMany'
import { R3TARDS_ROUTER_LAB_ABI } from '../lib/generated/abi'
import { ERC20_METADATA_ABI, MOCK_DIRECTORY_ABI, MONOPER_ABI } from './mrc17'
import {
  MAINNET_TOKENS,
  MAINNET_VENUES,
  MONOPER_ADDRESS,
  classifyCodeHash,
  statusLabel,
  type CodeHashState,
  type RouterToken,
  type RouterVenue,
} from './venues'

export const ROUTER_THROWAWAY = '0x00000000000000000000000000000000000072e3' as Address
/**
 * Defaults tuned on mainnet (2026-10-01, 1 WMON → USDC): quotes used 55k–723k gas. 1M per frame with the probe
 * off keeps a five-venue RUN under Monad RPCs' 8.1M low-gas eth_call pool; raise either when a row hits its cap.
 */
export const DEFAULT_GAS_PER_FRAME = 1_000_000n
export const DEFAULT_PROBE_STATIC = false
/** eth_call requests above this go to the RPC providers' smaller high-gas pool. */
export const LOW_GAS_POOL_LIMIT = 8_100_000n
export const FRAME_OVERHEAD = 60_000n
export const MAX_VENUES = 8

export interface RouterQuoteReport {
  adapter: Address
  status: number
  amountOut: bigint
  gasUsed: bigint
  returnSize: bigint
  revertSelector: Hex
  revertData: Hex
  swapDataLength: bigint
  swapDataHash: Hex
  staticProbe: number
  staticGasUsed: bigint
}

export interface RouterComparison {
  blockNumber: bigint
  timestamp: bigint
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  gasPerFrame: bigint
  winner: bigint
  reports: RouterQuoteReport[]
  blockPinned: boolean
}

export interface RouterSimReport {
  adapter: Address
  quoteStatus: number
  quoted: bigint
  quoteGas: bigint
  swapOk: boolean
  delivered: bigint
  swapGas: bigint
  swapRevertSelector: Hex
}

export interface RouterSimulation {
  blockNumber: bigint
  reports: RouterSimReport[]
  source: 'override' | 'wallet'
}

export interface RouterEnvironment {
  lab?: Address
  directory?: Address
  venues: RouterVenue[]
  mock: boolean
  wrappedNative?: Address
}

export interface TokenMeta extends RouterToken {
  symbol: string
  decimals: number
}

export interface VenueCodeInfo {
  code?: Hex
  codeHash?: Hex
  state: CodeHashState
}

let envPromise: Promise<RouterEnvironment> | undefined
const metadataCache = new Map<string, Promise<TokenMeta>>()
const codeCache = new Map<string, Promise<VenueCodeInfo>>()

function addressKey(address: Address) {
  return address.toLowerCase()
}

export function resetRouterCachesForTest() {
  envPromise = undefined
  metadataCache.clear()
  codeCache.clear()
}

export async function loadRouterEnvironment(): Promise<RouterEnvironment> {
  envPromise ??= (async () => {
    const contracts = await discoverContracts()
    const lab = contracts.labs['router-lab']
    if (config.chainId === 143)
      return { lab, venues: [...MAINNET_VENUES], mock: false, wrappedNative: MAINNET_TOKENS.WMON }
    const directory = contracts.labs['router-mock-venues']
    if (!directory || !publicClient) return { lab, directory, venues: [], mock: true }
    try {
      const result = await publicClient.readContract({
        address: directory,
        abi: MOCK_DIRECTORY_ABI,
        functionName: 'venues',
      })
      const [adapters, labels, token0, token1] = result as readonly [Address[], string[], Address, Address]
      const venues = adapters.map((adapter, index) => ({
        label: labels[index] ?? `mock-${index}`,
        adapter,
        token0,
        token1,
        source: 'router-mock-venues',
        mock: true,
      }))
      return { lab, directory, venues, mock: true, wrappedNative: token0 }
    } catch {
      return { lab, directory, venues: [], mock: true }
    }
  })()
  // A failed discovery (RPC offline) must not be cached for the whole session.
  envPromise.catch(() => {
    envPromise = undefined
  })
  return envPromise
}

export async function tokenMetadata(address: Address): Promise<TokenMeta> {
  const key = addressKey(address)
  let promise = metadataCache.get(key)
  if (!promise) {
    promise = (async () => {
      const rows = await readMany(
        [
          { address, abi: ERC20_METADATA_ABI, functionName: 'symbol' },
          { address, abi: ERC20_METADATA_ABI, functionName: 'decimals' },
        ],
        { allowFailure: true },
      )
      const symbol = rows[0]?.status === 'success' ? String(rows[0].result) : `${address.slice(0, 6)}…`
      const decimals = rows[1]?.status === 'success' ? Number(rows[1].result) : 18
      return { address, symbol, decimals }
    })()
    metadataCache.set(key, promise)
  }
  return promise
}

export async function venueCodeInfo(venue: RouterVenue): Promise<VenueCodeInfo> {
  const key = addressKey(venue.adapter)
  let promise = codeCache.get(key)
  if (!promise) {
    promise = (async () => {
      if (!publicClient) return { state: 'unknown' as const }
      try {
        const code = await publicClient.getCode({ address: venue.adapter })
        if (!code || code === '0x') return { code: code ?? '0x', state: 'no-code' as const }
        const codeHash = keccak256(code)
        return {
          code,
          codeHash,
          state: classifyCodeHash(codeHash, venue.expectedCodeHash, true),
        }
      } catch {
        return { state: 'unknown' as const }
      }
    })()
    codeCache.set(key, promise)
  }
  return promise
}

function venueArgs(venues: readonly RouterVenue[]) {
  return venues.map((venue) => ({ adapter: venue.adapter, quoteData: '0x' as Hex }))
}

function normalizeReport(value: any): RouterQuoteReport {
  return {
    adapter: (value?.adapter ?? value?.[0]) as Address,
    status: Number(value?.status ?? value?.[1] ?? 7),
    amountOut: BigInt(value?.amountOut ?? value?.[2] ?? 0),
    gasUsed: BigInt(value?.gasUsed ?? value?.[3] ?? 0),
    returnSize: BigInt(value?.returnSize ?? value?.[4] ?? 0),
    revertSelector: (value?.revertSelector ?? value?.[5] ?? '0x00000000') as Hex,
    revertData: (value?.revertData ?? value?.[6] ?? '0x') as Hex,
    swapDataLength: BigInt(value?.swapDataLength ?? value?.[7] ?? 0),
    swapDataHash: (value?.swapDataHash ?? value?.[8] ?? `0x${'0'.repeat(64)}`) as Hex,
    staticProbe: Number(value?.staticProbe ?? value?.[9] ?? 0),
    staticGasUsed: BigInt(value?.staticGasUsed ?? value?.[10] ?? 0),
  }
}

export function normalizeComparison(value: any, blockPinned = true): RouterComparison {
  const reports = (value?.reports ?? value?.[7] ?? []).map(normalizeReport)
  return {
    blockNumber: BigInt(value?.blockNumber ?? value?.[0] ?? 0),
    timestamp: BigInt(value?.timestamp ?? value?.[1] ?? 0),
    tokenIn: (value?.tokenIn ?? value?.[2]) as Address,
    tokenOut: (value?.tokenOut ?? value?.[3]) as Address,
    amountIn: BigInt(value?.amountIn ?? value?.[4] ?? 0),
    gasPerFrame: BigInt(value?.gasPerFrame ?? value?.[5] ?? 0),
    winner: BigInt(value?.winner ?? value?.[6] ?? 0),
    reports,
    blockPinned,
  }
}

export function normalizeSimulationReport(value: any): RouterSimReport {
  return {
    adapter: (value?.adapter ?? value?.[0]) as Address,
    quoteStatus: Number(value?.quoteStatus ?? value?.[1] ?? 7),
    quoted: BigInt(value?.quoted ?? value?.[2] ?? 0),
    quoteGas: BigInt(value?.quoteGas ?? value?.[3] ?? 0),
    swapOk: Boolean(value?.swapOk ?? value?.[4]),
    delivered: BigInt(value?.delivered ?? value?.[5] ?? 0),
    swapGas: BigInt(value?.swapGas ?? value?.[6] ?? 0),
    swapRevertSelector: (value?.swapRevertSelector ?? value?.[7] ?? '0x00000000') as Hex,
  }
}

/** Gas the RUN eth_call asks for: the lab's preflight budget plus 10%. */
export function compareGas(count: number, gasPerFrame: bigint, probeStatic: boolean) {
  const need = BigInt(count) * (gasPerFrame * (probeStatic ? 2n : 1n) + FRAME_OVERHEAD) + 100_000n
  return (need * 110n) / 100n
}

export async function runCompare(args: {
  lab: Address
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  venues: readonly RouterVenue[]
  gasPerFrame: bigint
  probeStatic: boolean
  blockNumber?: bigint
}): Promise<RouterComparison> {
  if (!publicClient) throw new Error('RPC unavailable')
  if (!args.venues.length || args.venues.length > MAX_VENUES) throw new Error('venue count must be 1..8')
  const client = publicClient
  const blockNumber = args.blockNumber ?? (await client.getBlockNumber())
  const data = encodeFunctionData({
    abi: R3TARDS_ROUTER_LAB_ABI as any,
    functionName: 'compare',
    args: [
      args.tokenIn,
      args.tokenOut,
      args.amountIn,
      venueArgs(args.venues),
      args.gasPerFrame,
      args.probeStatic,
    ],
  })
  const gas = compareGas(args.venues.length, args.gasPerFrame, args.probeStatic)
  let result
  let pinned = true
  try {
    result = await client.call({ to: args.lab, data, blockNumber, gas })
  } catch (error) {
    if (args.blockNumber != null) throw error
    result = await client.call({ to: args.lab, data, gas })
    pinned = false
  }
  if (!result.data) throw new Error('router-lab returned no data')
  const decoded = decodeFunctionResult({
    abi: R3TARDS_ROUTER_LAB_ABI as any,
    functionName: 'compare',
    data: result.data,
  })
  return normalizeComparison(decoded, pinned)
}

function findRevertData(error: unknown, depth = 0): Hex | undefined {
  if (depth > 8 || error == null) return undefined
  if (typeof error === 'string' && /^0x[0-9a-f]+$/i.test(error)) return error as Hex
  if (typeof error !== 'object') return undefined
  const record = error as Record<string, unknown>
  for (const key of ['data', 'error', 'cause', 'details']) {
    const value = record[key]
    if (typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value)) return value as Hex
    const nested = findRevertData(value, depth + 1)
    if (nested) return nested
  }
  return undefined
}

export function decodeSimulationError(data: Hex): { blockNumber: bigint; reports: RouterSimReport[] } {
  const decoded = decodeErrorResult({ abi: R3TARDS_ROUTER_LAB_ABI as any, data }) as any
  if (decoded.errorName !== 'Simulation') throw new Error(`unexpected router revert: ${decoded.errorName}`)
  const args = decoded.args ?? []
  const blockNumber = BigInt(args.blockNumber ?? args[0] ?? 0)
  const reports = (args.reports ?? args[1] ?? []).map(normalizeSimulationReport)
  return { blockNumber, reports }
}

export async function runSimulation(args: {
  lab: Address
  wrappedNative: Address
  tokenOut: Address
  amountIn: bigint
  venues: readonly RouterVenue[]
  gasPerFrame: bigint
  blockNumber: bigint
  walletAccount?: Address
  walletBalance?: bigint
}): Promise<RouterSimulation> {
  if (!publicClient) throw new Error('RPC unavailable')
  const client = publicClient
  const data = encodeFunctionData({
    abi: R3TARDS_ROUTER_LAB_ABI as any,
    functionName: 'simulateNativeIn',
    args: [args.wrappedNative, args.tokenOut, venueArgs(args.venues), args.gasPerFrame],
  })
  const gas =
    ((BigInt(args.venues.length) * (args.gasPerFrame * 2n + FRAME_OVERHEAD * 2n) + 120_000n) * 11n) / 10n

  const attempt = async (source: 'override' | 'wallet') => {
    const account = source === 'override' ? ROUTER_THROWAWAY : args.walletAccount
    if (!account) throw new Error('wallet account unavailable')
    try {
      await client.call({
        to: args.lab,
        data,
        account,
        value: args.amountIn,
        blockNumber: args.blockNumber,
        gas,
        ...(source === 'override'
          ? ({ stateOverride: [{ address: ROUTER_THROWAWAY, balance: args.amountIn }] } as any)
          : {}),
      } as any)
      throw new Error('simulation unexpectedly returned')
    } catch (error) {
      const revertData = findRevertData(error)
      if (!revertData) throw error
      const decoded = decodeSimulationError(revertData)
      return { ...decoded, source }
    }
  }

  try {
    return await attempt('override')
  } catch (overrideError) {
    if (args.walletAccount && (args.walletBalance ?? 0n) >= args.amountIn) return attempt('wallet')
    throw new Error(
      `simulation needs eth_call state overrides or a wallet holding ≥ amount (nothing is sent): ${overrideError instanceof Error ? overrideError.message : String(overrideError)}`,
    )
  }
}

export async function runMonoperCrossCheck(args: {
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  venues: readonly RouterVenue[]
  blockNumber: bigint
}) {
  if (!publicClient) throw new Error('RPC unavailable')
  const params = {
    algorithmId: 0n,
    algorithmData: '0x' as Hex,
    tokenIn: args.tokenIn,
    tokenOut: args.tokenOut,
    amountIn: args.amountIn,
    candidates: venueArgs(args.venues),
  }
  const data = encodeFunctionData({ abi: MONOPER_ABI, functionName: 'quote', args: [params] })
  const result = await publicClient.call({ to: MONOPER_ADDRESS, data, blockNumber: args.blockNumber })
  if (!result.data) throw new Error('Monoper returned no data')
  const decoded = decodeFunctionResult({ abi: MONOPER_ABI, functionName: 'quote', data: result.data }) as any
  const envelope = decoded?.result ?? decoded
  const amountOut = BigInt(envelope?.amountOut ?? envelope?.[0] ?? 0)
  const resultData = (envelope?.resultData ?? envelope?.[1] ?? '0x') as Hex
  const [adapter, candidateIndex, swapData] = decodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }],
    resultData,
  )
  return { amountOut, adapter: adapter as Address, candidateIndex, swapData: swapData as Hex }
}

export function traceLines(args: {
  comparison: RouterComparison
  venues: readonly RouterVenue[]
  tokenInSymbol: string
  tokenOutSymbol: string
  amountText: string
  outputDecimals: number
  formatOutput: (value: bigint, decimals: number) => string
}) {
  const { comparison } = args
  const lines = [
    `TRACE · block ${comparison.blockNumber} · 1 eth_call · gas/frame ${comparison.gasPerFrame.toLocaleString()}`,
    `frame 0  ROUTER-LAB compare  ${args.tokenInSymbol}→${args.tokenOutSymbol} ${args.amountText}`,
  ]
  comparison.reports.forEach((report, index) => {
    const venue = args.venues[index]
    const status = report.status === 0 ? 'ok' : statusLabel(report.status)
    const output = report.status === 0 ? args.formatOutput(report.amountOut, args.outputDecimals) : '—'
    lines.push(
      `frame ${index + 1}  ${(venue?.label ?? `venue-${index}`).toUpperCase().slice(0, 16).padEnd(16)} CALL ${report.gasUsed.toLocaleString()} gas  ${status}  ${output}  rolled back`,
    )
    if (report.staticProbe === 1) lines.push('          STATICCALL ok')
    if (report.staticProbe === 2)
      lines.push('          STATICCALL failed → quote path needs a non-static frame')
  })
  if (comparison.winner === (1n << 256n) - 1n) lines.push('select   no valid quoted output')
  else {
    const index = Number(comparison.winner)
    lines.push(
      `select   HIGHEST QUOTED OUTPUT = ${args.venues[index]?.label ?? index} (index ${index}; ties → lowest index)`,
    )
  }
  if (!comparison.blockPinned) lines.push('note     block pin unavailable; RPC evaluated latest instead')
  return lines
}
