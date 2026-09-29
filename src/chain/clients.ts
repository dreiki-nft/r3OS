import { createPublicClient, defineChain, fallback, http, webSocket, type Address } from 'viem'
import { config, chainName } from './config'
import { rateLimited } from './rateLimit'
import { startRpcStatsLogger, withRpcStats } from './rpcStats'

export const appChain = defineChain({
  id: config.chainId,
  name: chainName,
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: config.rpcUrls[0] ? [config.rpcUrls[0]] : [] } },
  blockExplorers: config.explorerUrl ? { default: { name: 'Explorer', url: config.explorerUrl } } : undefined,
  contracts: config.multicall3Address
    ? { multicall3: { address: config.multicall3Address as Address } }
    : undefined,
})

/** Wallet metadata never contains any app RPC URL. */
export const walletChain = defineChain({
  id: config.chainId,
  name: chainName,
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: config.walletRpcUrl ? [config.walletRpcUrl] : [] } },
  blockExplorers: config.explorerUrl ? { default: { name: 'Explorer', url: config.explorerUrl } } : undefined,
})

startRpcStatsLogger()

const batch = config.rpcBatchSize > 0 ? { batchSize: config.rpcBatchSize, wait: 16 } : false
export const appTransport = config.rpcUrls.length
  ? fallback(
      config.rpcUrls.map((url) =>
        rateLimited(
          http(url, {
            batch,
            retryCount: 3,
            retryDelay: 400,
            timeout: 15_000,
          }),
          config.rpcRps,
        ),
      ),
      { rank: false, retryCount: 1 },
    )
  : http('http://127.0.0.1:8545')

export const publicClient = config.demo
  ? undefined
  : createPublicClient({
      chain: appChain,
      transport: withRpcStats(appTransport),
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
