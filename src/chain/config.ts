import { isAddress, type Address } from 'viem'

export interface AppConfig {
  chainId: number
  rpcUrl: string
  wsUrl: string
  walletRpcUrl: string
  explorerUrl: string
  paintAddress?: Address
  multicall3Address?: Address
  nftApiUrl: string
  ipfsGateway: string
  labs: Partial<Record<'flipbook' | 'weeds' | 'forks' | 'brushes' | 'finale auction' | 'quests', Address>>
  demo: boolean
}

function env(name: string) {
  return String((import.meta.env as Record<string, unknown>)[name] ?? '').trim()
}

function address(name: string, fallback?: string): Address | undefined {
  const value = env(name) || fallback || ''
  return isAddress(value) ? value : undefined
}

const paint = address('VITE_PAINT_ADDRESS', env('VITE_CONTRACT_ADDRESS'))
const rpc = env('VITE_RPC_URL')

export const config: Readonly<AppConfig> = Object.freeze({
  chainId: Number(env('VITE_CHAIN_ID') || 10143),
  rpcUrl: rpc,
  wsUrl: env('VITE_WS_URL'),
  walletRpcUrl: env('VITE_WALLET_RPC_URL'),
  explorerUrl: env('VITE_EXPLORER_URL').replace(/\/$/, ''),
  paintAddress: paint,
  multicall3Address: address('VITE_MULTICALL3_ADDRESS'),
  nftApiUrl: env('VITE_NFT_API_URL'),
  ipfsGateway: env('VITE_IPFS_GATEWAY') || 'https://ipfs.io/ipfs/',
  labs: {
    flipbook: address('VITE_FLIPBOOK_ADDRESS'),
    weeds: address('VITE_WEEDS_ADDRESS'),
    forks: address('VITE_FORKS_ADDRESS'),
    brushes: address('VITE_BRUSHES_ADDRESS'),
    'finale auction': address('VITE_AUCTION_ADDRESS'),
    quests: address('VITE_QUESTS_ADDRESS'),
  },
  demo: !rpc || !paint,
})

export const MONAD_NAMES: Record<number, string> = { 143: 'Monad', 10143: 'Monad Testnet' }
export const chainName = MONAD_NAMES[config.chainId] ?? `Monad ${config.chainId}`
