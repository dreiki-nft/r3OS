import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  isAddress,
  type Address,
} from 'viem'

const envChainId = Number(import.meta.env.VITE_CHAIN_ID || 10143)
export const rpcUrl = String(import.meta.env.VITE_RPC_URL || '').trim()
export const explorerUrl = String(import.meta.env.VITE_EXPLORER_URL || '').trim()
const rawContractAddress = String(import.meta.env.VITE_CONTRACT_ADDRESS || '').trim()

export const contractAddress: Address | null = isAddress(rawContractAddress)
  ? rawContractAddress as Address
  : null

export const chain = defineChain({
  id: envChainId,
  name: envChainId === 143 ? 'Monad' : envChainId === 10143 ? 'Monad Testnet' : `Chain ${envChainId}`,
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: {
    default: {
      http: rpcUrl ? [rpcUrl] : [],
    },
  },
  blockExplorers: explorerUrl
    ? { default: { name: 'Explorer', url: explorerUrl } }
    : undefined,
})

export const publicClient = rpcUrl
  ? createPublicClient({ chain, transport: http(rpcUrl) })
  : null

export function injectedProvider(): { request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown> } | null {
  const provider = (window as Window & { ethereum?: unknown }).ethereum
  if (!provider || typeof provider !== 'object' || !('request' in provider)) return null
  return provider as { request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown> }
}

export function walletClient() {
  const provider = injectedProvider()
  if (!provider) return null
  return createWalletClient({ chain, transport: custom(provider) })
}

export async function ensureMonadChain() {
  const provider = injectedProvider()
  if (!provider) throw new Error('No injected wallet found.')
  const chainIdHex = `0x${chain.id.toString(16)}`

  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainIdHex }],
    })
  } catch (error) {
    const code = (error as { code?: number }).code
    if (code !== 4902 || !rpcUrl) throw error

    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: chainIdHex,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: [rpcUrl],
        blockExplorerUrls: explorerUrl ? [explorerUrl] : [],
      }],
    })
  }
}
