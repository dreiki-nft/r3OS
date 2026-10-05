import { createPublicClient, defineChain, fallback, http, webSocket, type Address } from 'viem'
import { config, chainName } from './config'
import { rateLimited } from './rateLimit'
import { startRpcStatsLogger, withRpcStats } from './rpcStats'
import {
  PUBLIC_RPC_RANK_INTERVAL_MS,
  PUBLIC_RPC_RANK_SAMPLE_COUNT,
  PUBLIC_RPC_RANK_TIMEOUT_MS,
  PUBLIC_RPC_RANK_WEIGHTS,
  PUBLIC_RPC_RETRY_COUNT,
  PUBLIC_RPC_TIMEOUT_MS,
} from './readRpcPolicy'

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

const batch = config.rpcBatchSize > 0 ? { batchSize: config.rpcBatchSize, wait: 4 } : false
export const appTransport = config.rpcUrls.length
  ? fallback(
      config.rpcUrls.map((url) =>
        rateLimited(
          http(url, {
            batch,
            retryCount: PUBLIC_RPC_RETRY_COUNT,
            timeout: PUBLIC_RPC_TIMEOUT_MS,
          }),
          config.rpcRps,
        ),
      ),
      {
        // A background/public read must not sit on one sick provider long enough to freeze a program.
        // Rank slowly in the background, then fail over immediately on timeout/error. The custom ping is
        // universally available on Monad and avoids relying on net_listening support.
        rank: {
          interval: PUBLIC_RPC_RANK_INTERVAL_MS,
          sampleCount: PUBLIC_RPC_RANK_SAMPLE_COUNT,
          timeout: PUBLIC_RPC_RANK_TIMEOUT_MS,
          weights: PUBLIC_RPC_RANK_WEIGHTS,
          ping: ({ transport }) => transport.request({ method: 'eth_blockNumber' }),
        },
        retryCount: 0,
      },
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

/**
 * Independent low-latency HTTP clients for user-triggered action work.
 *
 * Do not wrap these in the background batch/rate-limit queue. The action RPC pool measures them locally,
 * prefers the healthy/fast endpoints for reads, and can broadcast one signed raw transaction to every
 * configured endpoint without ever exposing the endpoint URLs in diagnostics.
 */
export const actionEndpointClients = config.demo
  ? []
  : config.rpcUrls.map((url) =>
      createPublicClient({
        chain: appChain,
        transport: withRpcStats(
          http(url, {
            batch: false,
            retryCount: 0,
            timeout: 1_500,
          }),
        ),
        pollingInterval: 125,
        cacheTime: 0,
      }),
    )

export const wsClient = config.wsUrl
  ? createPublicClient({
      chain: appChain,
      transport: withRpcStats(webSocket(config.wsUrl, { reconnect: { attempts: 100, delay: 1_000 } })),
      pollingInterval: 250,
      cacheTime: 0,
    })
  : undefined
