import { describe, expect, it } from 'vitest'
import { buildAddChainParams } from './wallet'
describe('wallet chain params', () => {
  it('uses only the wallet rpc', () => {
    const p = buildAddChainParams('https://public.monad.invalid')!
    expect(p.rpcUrls).toEqual(['https://public.monad.invalid'])
    expect(JSON.stringify(p)).not.toContain('wss://')
    expect(JSON.stringify(p)).not.toContain('VITE_RPC_URL')
  })
  it('does not add a chain without a public wallet rpc', () => expect(buildAddChainParams('')).toBeNull())
})

describe('unknown-chain errors from different wallets', () => {
  it('recognises MetaMask, wrapped and message-only forms', async () => {
    const { isUnknownChainError } = await import('./wallet')
    expect(isUnknownChainError({ code: 4902 })).toBe(true)
    expect(isUnknownChainError({ code: -32603, data: { originalError: { code: 4902 } } })).toBe(true)
    expect(isUnknownChainError({ code: -32603, message: 'Unrecognized chain ID "0x8f". Try adding the chain' })).toBe(true)
    expect(isUnknownChainError({ code: 4001, message: 'User rejected the request.' })).toBe(false)
    expect(isUnknownChainError({ code: -32603, message: 'Internal error' })).toBe(false)
  })
})
