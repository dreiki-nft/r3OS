import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Address } from 'viem'
import { shouldRecordRemoteRender } from '../paint/renderPerf'

const ACCOUNT = '0x00000000000000000000000000000000000000aa' as Address

function installWalletBrowser() {
  const local = new Map<string, string>()
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>()
  let authorized = true
  const provider = {
    async request({ method }: { method: string }) {
      if (method === 'eth_requestAccounts') {
        authorized = true
        return [ACCOUNT]
      }
      if (method === 'eth_accounts') return authorized ? [ACCOUNT] : []
      if (method === 'eth_chainId') return '0x8f'
      return null
    },
    on(event: string, fn: (...args: unknown[]) => void) {
      const set = handlers.get(event) ?? new Set()
      set.add(fn)
      handlers.set(event, set)
    },
    removeListener(event: string, fn: (...args: unknown[]) => void) {
      handlers.get(event)?.delete(fn)
    },
  }
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => void local.set(key, value),
    removeItem: (key: string) => void local.delete(key),
  })
  vi.stubGlobal('window', {
    ethereum: provider,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  })
  return {
    provider,
    emit(event: string, ...args: unknown[]) {
      for (const fn of handlers.get(event) ?? []) fn(...args)
    },
    revoke() {
      authorized = false
    },
  }
}

vi.mock('../chain/clients', () => ({
  publicClient: undefined,
  walletChain: {
    id: 143,
    name: 'Monad',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: ['http://127.0.0.1:1'] } },
  },
}))

describe('Lifecycle recovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('does not contaminate remote-paint latency with background-tab suspension time', () => {
    expect(shouldRecordRemoteRender(100, 90, false)).toBe(true)
    expect(shouldRecordRemoteRender(100, 110, false)).toBe(false)
    expect(shouldRecordRemoteRender(100, 90, true)).toBe(false)
  })

  it('survives wallet account removal, reconnect, chain change and provider disconnect in one session', async () => {
    const browser = installWalletBrowser()
    const wallet = await import('../chain/wallet')
    wallet.initWalletDiscovery()
    await wallet.connectWallet()
    expect(wallet.getWalletSnapshot().account).toBe(ACCOUNT)

    browser.emit('accountsChanged', [])
    expect(wallet.getWalletSnapshot().account).toBeUndefined()

    await wallet.connectWallet()
    expect(wallet.getWalletSnapshot().account).toBe(ACCOUNT)

    browser.emit('chainChanged', '0x279f')
    expect(wallet.getWalletSnapshot().chainId).toBe(0x279f)

    browser.emit('disconnect', new Error('provider gone'))
    expect(wallet.getWalletSnapshot().account).toBeUndefined()
  })

  it('fails silent restore closed when a remembered wallet revoked site authorization', async () => {
    const browser = installWalletBrowser()
    localStorage.setItem('r3os.wallet', 'Injected wallet')
    browser.revoke()
    const wallet = await import('../chain/wallet')
    wallet.initWalletDiscovery()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(wallet.getWalletSnapshot().account).toBeUndefined()
  })
})
