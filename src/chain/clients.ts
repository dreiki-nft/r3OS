import { createPublicClient, defineChain, http, webSocket, type Address } from 'viem'
import { config, chainName } from './config'
import { startRpcStatsLogger, withRpcStats } from './rpcStats'

export const appChain = defineChain({
  id: config.chainId,
  name: chainName,
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl || 'http://127.0.0.1:8545'] } },
  blockExplorers: config.explorerUrl ? { default: { name: 'Explorer', url: config.explorerUrl } } : undefined,
  contracts: config.multicall3Address
    ? { multicall3: { address: config.multicall3Address as Address } }
    : undefined,
})

/** Wallet metadata never contains the app RPC URL. */
export const walletChain = defineChain({
  id: config.chainId,
  name: chainName,
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: config.walletRpcUrl ? [config.walletRpcUrl] : [] } },
  blockExplorers: config.explorerUrl ? { default: { name: 'Explorer', url: config.explorerUrl } } : undefined,
})

startRpcStatsLogger()

export const publicClient = config.demo
  ? undefined
  : createPublicClient({
      chain: appChain,
      transport: withRpcStats(http(config.rpcUrl, { batch: true })),
      pollingInterval: 250,
      cacheTime: 0,
    })

export const wsClient = config.wsUrl
  ? createPublicClient({
      chain: appChain,
      transport: withRpcStats(webSocket(config.wsUrl, { reconnect: { attempts: 100, delay: 1_000 } })),
      pollingInterval: 250,
      cacheTime: 0,
    })
  : undefined
