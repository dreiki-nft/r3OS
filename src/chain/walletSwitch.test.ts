import { afterEach, describe, expect, it, vi } from 'vitest'

// Wallets that switch networks without telling anyone: no chainChanged event, or none at all.
vi.mock('./clients', () => ({
  publicClient: undefined,
  walletChain: {
    id: 143,
    name: 'Monad',
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: ['http://127.0.0.1:1'] } },
  },
}))

vi.mock('./config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config')>()
  return { ...actual, config: { ...actual.config, chainId: 143, walletRpcUrl: 'https://wallet-rpc.invalid' } }
})

const ACCOUNT = '0x00000000000000000000000000000000000000aa'

type Behaviour = { knowsMonad: boolean; switchesOnAdd: boolean; switches: boolean }

async function connectWith(behaviour: Behaviour) {
  let chain = '0x1'
  const calls: string[] = []
  const provider = {
    async request({ method }: { method: string }) {
      calls.push(method)
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [ACCOUNT]
      if (method === 'eth_chainId') return chain
      if (method === 'wallet_switchEthereumChain') {
        if (!behaviour.knowsMonad) throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 })
        if (behaviour.switches) chain = '0x8f'
        return null
      }
      if (method === 'wallet_addEthereumChain') {
        behaviour.knowsMonad = true
        if (behaviour.switchesOnAdd) chain = '0x8f'
        return null
      }
      return null
    },
    // no `on`: this wallet never emits chainChanged
  }
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} })
  vi.stubGlobal('window', { ethereum: provider, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} })
  const wallet = await import('./wallet')
  wallet.initWalletDiscovery()
  await wallet.connectWallet()
  return { wallet, calls }
}

describe('switching to Monad without chainChanged events', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('notices a switch the wallet never announced', async () => {
    const { wallet } = await connectWith({ knowsMonad: true, switchesOnAdd: false, switches: true })
    expect(wallet.walletOnCorrectChain()).toBe(false)
    await wallet.switchToMonad(0)
    expect(wallet.walletOnCorrectChain()).toBe(true)
  })

  it('asks again when a wallet adds Monad without selecting it', async () => {
    const { wallet, calls } = await connectWith({ knowsMonad: false, switchesOnAdd: false, switches: true })
    await wallet.switchToMonad(0)
    expect(calls.filter((call) => call === 'wallet_switchEthereumChain')).toHaveLength(2)
    expect(wallet.walletOnCorrectChain()).toBe(true)
  })

  it('says so plainly when the wallet stays on another network', async () => {
    const { wallet } = await connectWith({ knowsMonad: true, switchesOnAdd: false, switches: false })
    await expect(wallet.switchToMonad(0)).rejects.toThrow('WALLET_DID_NOT_SWITCH')
    const { friendlyError } = await import('./errors')
    expect(friendlyError(new Error('WALLET_DID_NOT_SWITCH')).message).toContain('chain ID 143')
  })
})
