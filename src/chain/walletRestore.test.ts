import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// No network in unit tests: the balance read is skipped when there is no public client.
vi.mock('./clients', () => ({
  publicClient: undefined,
  walletChain: {
    id: 143,
    name: 'Monad',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: ['http://127.0.0.1:1'] } },
  },
}))

const ACCOUNT = '0x00000000000000000000000000000000000000aa'

function installBrowser(authorized: { value: boolean }) {
  const store = new Map<string, string>()
  const calls: string[] = []
  const provider = {
    async request({ method }: { method: string }) {
      calls.push(method)
      if (method === 'eth_requestAccounts') {
        authorized.value = true
        return [ACCOUNT]
      }
      if (method === 'eth_accounts') return authorized.value ? [ACCOUNT] : []
      if (method === 'eth_chainId') return '0x8f'
      return null
    },
    on() {},
    removeListener() {},
  }
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
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
  return { store, calls }
}

describe('wallet is remembered across reloads', () => {
  const authorized = { value: false }
  let browser: ReturnType<typeof installBrowser>

  beforeEach(() => {
    authorized.value = false
    browser = installBrowser(authorized)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('reconnects silently with eth_accounts after a reload, and forgets on disconnect', async () => {
    const first = await import('./wallet')
    first.initWalletDiscovery()
    await first.connectWallet()
    expect(browser.store.get('r3os.wallet')).toBe('Injected wallet')

    // "reload": a fresh module instance with the same storage and wallet
    vi.resetModules()
    browser.calls.length = 0
    const second = await import('./wallet')
    second.initWalletDiscovery()
    await vi.waitFor(() => expect(second.getWalletSnapshot().account).toBe(ACCOUNT))
    expect(browser.calls).toContain('eth_accounts')
    expect(browser.calls).not.toContain('eth_requestAccounts') // never prompts on reload

    second.disconnectWallet()
    expect(browser.store.has('r3os.wallet')).toBe(false)
    vi.resetModules()
    const third = await import('./wallet')
    expect(await third.restoreWallet(0)).toBe(false)
    expect(third.getWalletSnapshot().account).toBeUndefined()
  })

  it('stays disconnected when the wallet no longer authorizes the site', async () => {
    browser.store.set('r3os.wallet', 'Injected wallet')
    const wallet = await import('./wallet')
    wallet.initWalletDiscovery()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(wallet.getWalletSnapshot().account).toBeUndefined()
    expect(browser.calls).toEqual(['eth_accounts'])
  })
})
