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
import { captureGuestKey, createGuestProvider, forgetGuestKey, GUEST_ICON, GUEST_RDNS } from './guestWallet'

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
let restorePromise: Promise<boolean> | undefined
let discoveryStarted = false

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

const isGuest = (choice: WalletChoice) => choice.info.rdns === GUEST_RDNS
let guestNotice: Address | undefined

/** True while the connected wallet is a judge's guest wallet. */
export function usingGuestWallet() {
  const guest = choices.get('r3os-guest')
  return Boolean(guest && state.provider && guest.provider === state.provider)
}

/** The guest wallet that was just opened from a link, once (the desktop shows a note about it). */
export function takeGuestNotice() {
  const address = guestNotice
  guestNotice = undefined
  return address
}

export function walletChoices() {
  // A judge who opened a guest link sees the guest wallet first; otherwise MetaMask first.
  const rank = (choice: WalletChoice) => (isGuest(choice) ? 0 : /metamask/i.test(choice.info.name) ? 1 : 2)
  return [...choices.values()].sort((a, b) => rank(a) - rank(b))
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

// The last wallet the user connected, by a stable id (EIP-6963 rdns, else its name). Only the id is stored,
// never an address or key: on reload we ask that wallet for already-authorized accounts with eth_accounts,
// which never opens a prompt, and silently restore the session if it still has one.
const REMEMBER_KEY = 'r3os.wallet'

export const walletChoiceId = (choice: WalletChoice) => choice.info.rdns || choice.info.name

function rememberWallet(choice?: WalletChoice) {
  try {
    if (choice) localStorage.setItem(REMEMBER_KEY, walletChoiceId(choice))
    else localStorage.removeItem(REMEMBER_KEY)
  } catch {
    // Storage can be blocked; the user just reconnects by hand.
  }
}

function rememberedWalletId() {
  try {
    return localStorage.getItem(REMEMBER_KEY) ?? undefined
  } catch {
    return undefined
  }
}

async function adoptAccounts(selected: WalletChoice, accounts: Address[]) {
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

/** Silent reconnect: no prompt. Gives up quietly if the wallet is gone or no longer authorizes this site. */
export function restoreWallet(waitMs = 400) {
  if (state.account) return Promise.resolve(false)
  if (restorePromise) return restorePromise
  const id = rememberedWalletId()
  if (!id) return Promise.resolve(false)

  const pending = (async () => {
    // EIP-6963 wallets announce asynchronously; give them a moment.
    const deadline = Date.now() + waitMs
    let selected = walletChoices().find((choice) => walletChoiceId(choice) === id)
    while (!selected && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      selected = walletChoices().find((choice) => walletChoiceId(choice) === id)
    }
    if (!selected) return false
    try {
      const accounts = (await selected.provider.request({ method: 'eth_accounts' })) as Address[]
      if (!accounts?.length || state.account) return false
      await adoptAccounts(selected, accounts)
      return true
    } catch {
      return false
    }
  })().finally(() => {
    if (restorePromise === pending) restorePromise = undefined
  })
  restorePromise = pending
  return pending
}

export function initWalletDiscovery() {
  if (typeof window === 'undefined' || discoveryStarted) return
  discoveryStarted = true
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
  const guest = captureGuestKey()
  if (guest) {
    try {
      const { address, provider } = createGuestProvider(guest.key)
      const choice: WalletChoice = {
        info: { uuid: 'r3os-guest', name: 'Guest wallet (judges)', icon: GUEST_ICON, rdns: GUEST_RDNS },
        provider,
      }
      choices.set(choice.info.uuid, choice)
      if (guest.fresh) {
        // Opening a guest link is the consent: connect straight away and say what this wallet is.
        void connectWallet(choice)
          .then(() => {
            guestNotice = address
            window.dispatchEvent(new Event('r3os:guest-wallet'))
          })
          .catch(() => forgetGuestKey())
        return
      }
    } catch {
      forgetGuestKey()
    }
  }
  void restoreWallet(800)
}

export async function connectWallet(choice?: WalletChoice) {
  const selected = choice ?? walletChoices()[0]
  if (!selected) throw new Error('NO_WALLET')
  const accounts = (await selected.provider.request({ method: 'eth_requestAccounts' })) as Address[]
  rememberWallet(selected)
  return adoptAccounts(selected, accounts)
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
  // Disconnecting a guest wallet also forgets its key for this tab.
  if (usingGuestWallet()) {
    forgetGuestKey()
    choices.delete('r3os-guest')
  }
  rememberWallet(undefined)
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
