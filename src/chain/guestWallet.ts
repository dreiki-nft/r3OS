/**
 * Guest wallets for judges. A judge opens a private link (r3os.app/#/guest/<key>) from the submission; the
 * key is captured before anything else reads the URL, removed from the address bar, kept only for this tab
 * (sessionStorage), and exposed as an ordinary EIP-6963 wallet so every existing flow (paint, Live Mode,
 * frames, CDs) works unchanged. Guest wallets are throwaway accounts holding a few cents of MON; treat
 * every guest key as public. Keys are never logged, shown, sent anywhere except signed transactions, or
 * written to localStorage.
 */
import {
  createWalletClient,
  http,
  isHex,
  numberToHex,
  type Address,
  type EIP1193Provider,
  type Hex,
  type TypedDataDefinition,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { publicClient, walletChain } from './clients'
import { config } from './config'

export const GUEST_SESSION_KEY = 'r3os.guestKey'
export const GUEST_RDNS = 'app.r3os.guest'
const ROUTE = /^#\/guest\/(0x)?([0-9a-fA-F]{64})\/?$/

/** Pure: the key in a guest route, or undefined. Accepts the key with or without 0x. */
export function guestKeyFromHash(hash: string): Hex | undefined {
  const match = ROUTE.exec(hash)
  return match ? (`0x${match[2].toLowerCase()}` as Hex) : undefined
}

function session() {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}

let captured: { key: Hex; fresh: boolean } | undefined

/**
 * Called once at startup, before routing. Moves a guest key from the URL into this tab's sessionStorage and
 * replaces the URL with #/paint, so the key never stays in the address bar or in later history entries.
 */
export function captureGuestKey(): { key: Hex; fresh: boolean } | undefined {
  if (captured || typeof location === 'undefined') return captured
  const fromUrl = guestKeyFromHash(location.hash)
  if (fromUrl) {
    try {
      history.replaceState(history.state, '', `${location.pathname}${location.search}#/paint`)
    } catch {
      location.hash = '#/paint'
    }
    try {
      session()?.setItem(GUEST_SESSION_KEY, fromUrl)
    } catch {
      // Blocked storage: the guest wallet still works for this page load.
    }
    captured = { key: fromUrl, fresh: true }
    return captured
  }
  let stored: string | null | undefined
  try {
    stored = session()?.getItem(GUEST_SESSION_KEY)
  } catch {
    stored = undefined
  }
  if (stored && isHex(stored) && stored.length === 66) captured = { key: stored as Hex, fresh: false }
  return captured
}

/**
 * A guest link pasted into a tab that already has r3OS open only changes the hash, so startup never sees it
 * (and the key would sit in the address bar). Reload once so it is captured exactly like a fresh visit.
 */
export function watchGuestLinks(
  target: Pick<Window, 'addEventListener' | 'removeEventListener' | 'location'> = window,
) {
  const onHash = () => {
    if (guestKeyFromHash(target.location.hash)) target.location.reload()
  }
  target.addEventListener('hashchange', onHash)
  return () => target.removeEventListener('hashchange', onHash)
}

export function forgetGuestKey() {
  captured = undefined
  try {
    session()?.removeItem(GUEST_SESSION_KEY)
  } catch {
    // nothing stored
  }
}

function rpcError(code: number, message: string) {
  return Object.assign(new Error(message), { code })
}

/** A minimal EIP-1193 provider backed by the guest key. Reads go to the app's public client. */
export function createGuestProvider(key: Hex): { address: Address; provider: EIP1193Provider } {
  const account = privateKeyToAccount(key)
  // Created on the first transaction, so a guest wallet can exist (and sign) even before an RPC is known.
  let wallet: ReturnType<typeof createWalletClient> | undefined
  const walletClient = () => {
    const url = config.walletRpcUrl || config.rpcUrls[0]
    if (!url) throw rpcError(4900, 'no RPC configured for the guest wallet')
    wallet ??= createWalletClient({ account, chain: walletChain, transport: http(url) })
    return wallet
  }
  const chainHex = numberToHex(config.chainId)

  const request = (async ({ method, params }: { method: string; params?: unknown[] }) => {
    const args = (params ?? []) as unknown[]
    switch (method) {
      case 'eth_accounts':
      case 'eth_requestAccounts':
        return [account.address]
      case 'eth_chainId':
        return chainHex
      case 'net_version':
        return String(config.chainId)
      case 'wallet_switchEthereumChain': {
        const wanted = String((args[0] as { chainId?: string })?.chainId ?? '').toLowerCase()
        if (wanted === chainHex.toLowerCase()) return null
        throw rpcError(4902, 'the guest wallet only works on this chain')
      }
      case 'wallet_addEthereumChain':
        return null
      case 'wallet_getCapabilities':
      case 'wallet_sendCalls':
        throw rpcError(4200, 'not supported by the guest wallet')
      case 'personal_sign': {
        const message = args[0] as Hex
        return account.signMessage({ message: isHex(message) ? { raw: message } : String(message) })
      }
      case 'eth_signTypedData_v4': {
        const typed = (typeof args[1] === 'string' ? JSON.parse(args[1]) : args[1]) as TypedDataDefinition & {
          types: Record<string, unknown>
        }
        const { EIP712Domain: _domain, ...types } = typed.types as Record<string, unknown>
        return account.signTypedData({ ...typed, types } as TypedDataDefinition)
      }
      case 'eth_sendTransaction': {
        const tx = args[0] as { to?: Address; data?: Hex; value?: Hex; gas?: Hex }
        return walletClient().sendTransaction({
          account,
          chain: walletChain,
          to: tx.to,
          data: tx.data,
          value: tx.value ? BigInt(tx.value) : undefined,
          gas: tx.gas ? BigInt(tx.gas) : undefined,
        })
      }
      case 'eth_sign':
      case 'eth_signTransaction':
        throw rpcError(4200, 'not supported by the guest wallet')
      default:
        if (!publicClient) throw rpcError(4900, 'offline')
        return publicClient.request({ method, params } as never)
    }
  }) as EIP1193Provider['request']

  const provider = {
    request,
    on: () => undefined,
    removeListener: () => undefined,
  } as unknown as EIP1193Provider
  return { address: account.address, provider }
}

/** Small inline icon (data: images are allowed by the site's CSP). */
export const GUEST_ICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#5FEDDF"/><path d="M4 11l5-7 3 2-5 7H4z" fill="#000"/></svg>',
  )
