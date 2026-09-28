import {
  createWalletClient,
  custom,
  formatEther,
  type Address,
  type EIP1193Provider,
  type WalletClient,
} from 'viem'
import { publicClient, walletChain } from './clients'
import { config, chainName } from './config'

export interface WalletChoice {
  info: { uuid: string; name: string; icon?: string; rdns?: string }
  provider: EIP1193Provider
}

export interface WalletState {
  account?: Address
  chainId?: number
  balance?: bigint
  provider?: EIP1193Provider
  client?: WalletClient
}

type Listener = () => void
type ListeningProvider = EIP1193Provider & {
  on?: (event: string, fn: (...args: unknown[]) => void) => void
  removeListener?: (event: string, fn: (...args: unknown[]) => void) => void
}

let state: WalletState = {}
const listeners = new Set<Listener>()
const choices = new Map<string, WalletChoice>()
const handlers = new WeakMap<object, Record<string, (...args: unknown[]) => void>>()

function emit() {
  for (const listener of listeners) listener()
}

export function subscribeWallet(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getWalletSnapshot() {
  return state
}

export function walletChoices() {
  return [...choices.values()].sort(
    (a, b) => Number(!/metamask/i.test(a.info.name)) - Number(!/metamask/i.test(b.info.name)),
  )
}

export function buildAddChainParams(walletRpcUrl = config.walletRpcUrl) {
  if (!walletRpcUrl) return null
  return {
    chainId: `0x${config.chainId.toString(16)}`,
    chainName,
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: [walletRpcUrl],
    ...(config.explorerUrl ? { blockExplorerUrls: [config.explorerUrl] } : {}),
  }
}

export async function refreshWalletBalance() {
  if (!state.account || !publicClient) return
  try {
    const balance = await publicClient.getBalance({ address: state.account })
    state = { ...state, balance }
    emit()
  } catch {
    // RPC may be temporarily offline. Keep the last known balance.
  }
}

function detach(provider?: EIP1193Provider) {
  if (!provider) return
  const p = provider as ListeningProvider
  const registered = handlers.get(provider as object)
  if (!registered) return
  for (const [event, handler] of Object.entries(registered)) p.removeListener?.(event, handler)
  handlers.delete(provider as object)
}

function attach(provider: EIP1193Provider) {
  const objectProvider = provider as object
  if (handlers.has(objectProvider)) return
  const p = provider as ListeningProvider

  const onAccounts = (...args: unknown[]) => {
    const accounts = (args[0] ?? []) as Address[]
    if (!accounts.length) {
      state = {}
      emit()
      return
    }
    state = { ...state, account: accounts[0] }
    void refreshWalletBalance()
    emit()
  }
  const onChain = (...args: unknown[]) => {
    const chainHex = String(args[0] ?? '0x0')
    state = { ...state, chainId: Number(chainHex) }
    void refreshWalletBalance()
    emit()
  }
  const onDisconnect = () => {
    detach(provider)
    state = {}
    emit()
  }

  const registered = {
    accountsChanged: onAccounts,
    chainChanged: onChain,
    disconnect: onDisconnect,
  }
  handlers.set(objectProvider, registered)
  for (const [event, handler] of Object.entries(registered)) p.on?.(event, handler)
}

export function initWalletDiscovery() {
  if (typeof window === 'undefined') return
  window.addEventListener('eip6963:announceProvider', ((event: CustomEvent<WalletChoice>) => {
    choices.set(event.detail.info.uuid, event.detail)
    emit()
  }) as EventListener)
  window.dispatchEvent(new Event('eip6963:requestProvider'))
  const injected = (window as Window & { ethereum?: EIP1193Provider }).ethereum
  if (injected) {
    choices.set('window.ethereum', {
      info: { uuid: 'window.ethereum', name: 'Injected wallet' },
      provider: injected,
    })
  }
}

export async function connectWallet(choice?: WalletChoice) {
  const selected = choice ?? walletChoices()[0]
  if (!selected) throw new Error('NO_WALLET')
  const accounts = (await selected.provider.request({ method: 'eth_requestAccounts' })) as Address[]
  const chainHex = (await selected.provider.request({ method: 'eth_chainId' })) as string
  const client = createWalletClient({ chain: walletChain, transport: custom(selected.provider) })
  state = {
    account: accounts[0],
    chainId: Number(chainHex),
    provider: selected.provider,
    client,
  }
  attach(selected.provider)
  await refreshWalletBalance()
  emit()
  return state
}

export async function switchToMonad() {
  if (!state.provider) throw new Error('NO_WALLET')
  try {
    await state.provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${config.chainId.toString(16)}` }],
    })
  } catch (error) {
    const code = (error as { code?: number }).code
    if (code !== 4902) throw error
    const params = buildAddChainParams()
    if (!params) throw new Error('WALLET_RPC_MISSING')
    await state.provider.request({ method: 'wallet_addEthereumChain', params: [params] })
  }
}

export function disconnectWallet() {
  detach(state.provider)
  state = {}
  emit()
}

export const walletOnCorrectChain = () => state.chainId === config.chainId
export const formattedBalance = () =>
  state.balance == null ? '—' : `${Number(formatEther(state.balance)).toFixed(4)} MON`
export const metamaskDeepLink = () =>
  typeof location === 'undefined'
    ? ''
    : `https://metamask.app.link/dapp/${location.host}${location.pathname}${location.hash}`
