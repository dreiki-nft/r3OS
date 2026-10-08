import { describe, expect, it } from 'vitest'
import { numberToHex, recoverMessageAddress, recoverTypedDataAddress } from 'viem'
import { config } from './config'
import { createGuestProvider, guestKeyFromHash } from './guestWallet'

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
})
