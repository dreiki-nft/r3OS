import { describe, expect, it, vi } from 'vitest'
import { numberToHex, recoverMessageAddress, recoverTypedDataAddress } from 'viem'
import { config } from './config'
import { createGuestProvider, guestKeyFromHash, watchGuestLinks } from './guestWallet'

// A throwaway test key; never funded anywhere.
const KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

describe('guest wallet', () => {
  it('only accepts an exact guest route with a 32-byte key', () => {
    expect(guestKeyFromHash(`#/guest/${KEY.slice(2)}`)).toBe(KEY)
    expect(guestKeyFromHash(`#/guest/${KEY}`)).toBe(KEY)
    expect(guestKeyFromHash(`#/guest/${KEY.slice(2).toUpperCase()}/`)).toBe(KEY)
    expect(guestKeyFromHash('#/guest/1234')).toBeUndefined()
    expect(guestKeyFromHash(`#/paint?guest=${KEY}`)).toBeUndefined()
    expect(guestKeyFromHash(`#/guest/${KEY.slice(2)}extra`)).toBeUndefined()
  })

  it('acts like a wallet on this chain and signs locally', async () => {
    const { address, provider } = createGuestProvider(KEY)
    expect(await provider.request({ method: 'eth_requestAccounts' })).toEqual([address])
    expect(await provider.request({ method: 'eth_chainId' })).toBe(numberToHex(config.chainId))
    expect(
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: numberToHex(config.chainId) }],
      } as never),
    ).toBeNull()
    await expect(
      provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] } as never),
    ).rejects.toMatchObject({ code: 4902 })

    const signature = (await provider.request({
      method: 'personal_sign',
      params: ['0x68656c6c6f', address],
    } as never)) as `0x${string}`
    expect(await recoverMessageAddress({ message: { raw: '0x68656c6c6f' }, signature })).toBe(address)

    const typed = {
      domain: { name: 'r3OS paint', version: '1', chainId: config.chainId },
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
        ],
        Session: [{ name: 'key', type: 'address' }],
      },
      primaryType: 'Session',
      message: { key: address },
    }
    const typedSig = (await provider.request({
      method: 'eth_signTypedData_v4',
      params: [address, JSON.stringify(typed)],
    } as never)) as `0x${string}`
    const { EIP712Domain: _domain, ...types } = typed.types
    expect(await recoverTypedDataAddress({ ...typed, types, signature: typedSig } as never)).toBe(address)
  })

  it('refuses batching and raw signing so nothing can sign outside a visible transaction', async () => {
    const { provider } = createGuestProvider(KEY)
    for (const method of ['wallet_getCapabilities', 'wallet_sendCalls', 'eth_sign', 'eth_signTransaction']) {
      await expect(provider.request({ method, params: [] } as never), method).rejects.toMatchObject({
        code: 4200,
      })
    }
  })

  function fakeTab() {
    let listener: (() => void) | undefined
    const tab = {
      reloads: 0,
      urls: [] as string[],
      fire: () => listener?.(),
      listening: () => Boolean(listener),
      location: {
        hash: '#/paint',
        pathname: '/',
        search: '',
        reload: () => tab.reloads++,
      },
      history: {
        state: null,
        replaceState: (_state: unknown, _title: string, url: string) => {
          tab.urls.push(url)
          tab.location.hash = url.slice(url.indexOf('#'))
        },
      },
      addEventListener: (_name: string, fn: () => void) => (listener = fn),
      removeEventListener: () => (listener = undefined),
    }
    return tab
  }

  it('asks before a guest link pasted into an open tab swaps the wallet', async () => {
    const tab = fakeTab()
    const stop = watchGuestLinks(tab as never, async () => true)
    tab.fire()
    expect(tab.reloads).toBe(0)
    tab.location.hash = `#/guest/${KEY.slice(2)}`
    tab.fire()
    // The key leaves the address bar before the question is even answered.
    expect(tab.urls[0]).toBe('/#/paint')
    await vi.waitFor(() => expect(tab.reloads).toBe(1))
    // Agreed: the key goes back for one reload, so startup captures it like a fresh visit.
    expect(tab.urls[1]).toBe(`/#/guest/${KEY.slice(2)}`)
    stop()
    expect(tab.listening()).toBe(false)
  })

  it('keeps the current wallet when the person says no', async () => {
    const tab = fakeTab()
    const ask = vi.fn(async () => false)
    watchGuestLinks(tab as never, ask)
    tab.location.hash = `#/guest/${KEY.slice(2)}`
    tab.fire()
    await vi.waitFor(() => expect(ask).toHaveBeenCalled())
    await Promise.resolve()
    expect(tab.reloads).toBe(0)
    expect(tab.location.hash).toBe('#/paint')
  })
})
