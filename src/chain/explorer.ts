import type { Hex } from 'viem'
import { config } from './config'

/**
 * MonadVision is the public explorer surface for the Monad networks r3OS supports.
 * Keep the configured explorer as a fallback for non-standard/dev chains.
 */
export function explorerBaseUrl(chainId = config.chainId) {
  if (chainId === 143) return 'https://monadvision.com'
  if (chainId === 10143) return 'https://testnet.monadvision.com'
  return config.explorerUrl
}

export function transactionExplorerUrl(hash: Hex, chainId = config.chainId) {
  const base = explorerBaseUrl(chainId).replace(/\/$/, '')
  return base ? `${base}/tx/${hash}` : undefined
}
