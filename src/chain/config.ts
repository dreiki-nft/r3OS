import { isAddress, type Address } from 'viem'

export interface AppConfig {
  chainId: number
  rpcUrl: string
  rpcUrls: string[]
  logsRange: number
  rpcRps: number
  rpcBatchSize: number
  fastlaneAcceleratorUrl: string
  fastlaneAcceleratorTimeoutMs: number
  deployBlock: bigint
  wsUrl: string
  walletRpcUrl: string
  explorerUrl: string
  paintAddress?: Address
  multicall3Address?: Address
  nftApiUrl: string
  ipfsGateway: string
  labs: Partial<Record<'finale auction' | 'quests', Address>>
  demo: boolean
}

/*
 * Every setting is read by its literal name. Reading import.meta.env with a variable key makes Vite inline the
 * whole env object into the public bundle, including variables the app never uses (e.g. Vercel's VITE_VERCEL_*).
 */
const ENV: Record<string, unknown> = {
  VITE_AUCTION_ADDRESS: import.meta.env.VITE_AUCTION_ADDRESS,
  VITE_CHAIN_ID: import.meta.env.VITE_CHAIN_ID,
  VITE_CONTRACT_ADDRESS: import.meta.env.VITE_CONTRACT_ADDRESS,
  VITE_DEPLOY_BLOCK: import.meta.env.VITE_DEPLOY_BLOCK,
  VITE_EXPLORER_URL: import.meta.env.VITE_EXPLORER_URL,
  VITE_FASTLANE_ACCELERATOR_TIMEOUT_MS: import.meta.env.VITE_FASTLANE_ACCELERATOR_TIMEOUT_MS,
  VITE_FASTLANE_ACCELERATOR_URL: import.meta.env.VITE_FASTLANE_ACCELERATOR_URL,
  VITE_IPFS_GATEWAY: import.meta.env.VITE_IPFS_GATEWAY,
  VITE_LOGS_RANGE: import.meta.env.VITE_LOGS_RANGE,
  VITE_MULTICALL3_ADDRESS: import.meta.env.VITE_MULTICALL3_ADDRESS,
  VITE_NFT_API_URL: import.meta.env.VITE_NFT_API_URL,
  VITE_PAINT_ADDRESS: import.meta.env.VITE_PAINT_ADDRESS,
  VITE_QUESTS_ADDRESS: import.meta.env.VITE_QUESTS_ADDRESS,
  VITE_RPC_BATCH_SIZE: import.meta.env.VITE_RPC_BATCH_SIZE,
  VITE_RPC_RPS: import.meta.env.VITE_RPC_RPS,
  VITE_RPC_URL: import.meta.env.VITE_RPC_URL,
  VITE_RPC_URLS: import.meta.env.VITE_RPC_URLS,
  VITE_WALLET_RPC_URL: import.meta.env.VITE_WALLET_RPC_URL,
  VITE_WS_URL: import.meta.env.VITE_WS_URL,
}

function env(name: string) {
  return String(ENV[name] ?? '').trim()
}

function positiveInt(name: string, fallback: number, allowZero = false) {
  const value = Number(env(name))
  if (!Number.isFinite(value) || !Number.isInteger(value)) return fallback
  if (allowZero ? value < 0 : value <= 0) return fallback
  return value
}

function nonNegativeBigInt(name: string, fallback = 0n) {
  try {
    const value = BigInt(env(name) || fallback.toString())
    return value < 0n ? fallback : value
  } catch {
    return fallback
  }
}

function address(name: string, fallback?: string): Address | undefined {
  const value = env(name) || fallback || ''
  return isAddress(value) ? value : undefined
}

const paint = address('VITE_PAINT_ADDRESS', env('VITE_CONTRACT_ADDRESS'))
const legacyRpc = env('VITE_RPC_URL')
const rpcUrls = Array.from(
  new Set([legacyRpc, ...env('VITE_RPC_URLS').split(',')].map((value) => value.trim()).filter(Boolean)),
)
const chainId = Number(env('VITE_CHAIN_ID') || 10143)
const canonicalMulticall3 =
  chainId === 143 || chainId === 10143 ? '0xcA11bde05977b3631167028862bE2a173976CA11' : undefined

export const config: Readonly<AppConfig> = Object.freeze({
  chainId,
  rpcUrl: rpcUrls[0] ?? '',
  rpcUrls,
  logsRange: positiveInt('VITE_LOGS_RANGE', 100),
  rpcRps: positiveInt('VITE_RPC_RPS', 12),
  rpcBatchSize: positiveInt('VITE_RPC_BATCH_SIZE', 10, true),
  fastlaneAcceleratorUrl: chainId === 143 ? env('VITE_FASTLANE_ACCELERATOR_URL') : '',
  fastlaneAcceleratorTimeoutMs: positiveInt('VITE_FASTLANE_ACCELERATOR_TIMEOUT_MS', 650),
  deployBlock: nonNegativeBigInt('VITE_DEPLOY_BLOCK'),
  wsUrl: env('VITE_WS_URL'),
  walletRpcUrl: env('VITE_WALLET_RPC_URL'),
  explorerUrl: env('VITE_EXPLORER_URL').replace(/\/$/, ''),
  paintAddress: paint,
  multicall3Address: address('VITE_MULTICALL3_ADDRESS', canonicalMulticall3),
  nftApiUrl: env('VITE_NFT_API_URL'),
  ipfsGateway: env('VITE_IPFS_GATEWAY') || 'https://ipfs.io/ipfs/',
  labs: {
    'finale auction': address('VITE_AUCTION_ADDRESS'),
    quests: address('VITE_QUESTS_ADDRESS'),
  },
  demo: !rpcUrls.length || !paint,
})

/**
 * Stable namespace for browser-persisted data that belongs to one Paint deployment.
 *
 * Chain id alone is not enough on testnet: redeploying Paint reuses frame/token ids,
 * so an old `10143:7` cache entry can otherwise be mistaken for frame #7 on the new
 * contract. Including the Paint address makes every deployment its own cache universe.
 */
export function deploymentScope(): string
export function deploymentScope(chainId: number, paintAddress?: Address): string
export function deploymentScope(chainId?: number, paintAddress?: Address) {
  const resolvedChainId = chainId ?? config.chainId
  const resolvedPaintAddress = chainId === undefined ? config.paintAddress : paintAddress
  return `${resolvedChainId}:${resolvedPaintAddress?.toLowerCase() ?? 'no-paint'}`
}

export const MONAD_NAMES: Record<number, string> = { 143: 'Monad', 10143: 'Monad Testnet' }
export const chainName = MONAD_NAMES[config.chainId] ?? `Monad ${config.chainId}`
