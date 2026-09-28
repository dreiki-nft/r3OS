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
