import { describe, expect, it } from 'vitest'
import type { Address } from 'viem'
import { deploymentScope, parseRpcUrls } from './config'

describe('deploymentScope', () => {
  it('separates browser state by chain and Paint deployment', () => {
    const oldPaint = '0xC9300a14EcdB1296ade8795073Ab97A813ae8cB4' as Address
    const newPaint = '0x032D5e1591DA2919A4aa5D24Ee9278bFE5F1CdA1' as Address

    expect(deploymentScope(10143, oldPaint)).toBe(
      '10143:0xc9300a14ecdb1296ade8795073ab97a813ae8cb4',
    )
    expect(deploymentScope(10143, newPaint)).toBe(
      '10143:0x032d5e1591da2919a4aa5d24ee9278bfe5f1cda1',
    )
    expect(deploymentScope(10143, oldPaint)).not.toBe(deploymentScope(10143, newPaint))
  })

  it('has an explicit namespace when Paint is unavailable', () => {
    expect(deploymentScope(10143, undefined)).toBe('10143:no-paint')
  })
})

describe('parseRpcUrls', () => {
  const A = 'https://rpc.monad.xyz'
  const B = 'https://rpc2.monad.xyz'
  const C = 'https://rpc3.monad.xyz'

  it('puts VITE_RPC_URL first, then VITE_RPC_URLS, without duplicates', () => {
    expect(parseRpcUrls(A, `${B},${A}, ${C}`)).toEqual([A, B, C])
  })

  it('accepts a comma list in the singular VITE_RPC_URL too', () => {
    expect(parseRpcUrls(`${A},${B},${C}`, '')).toEqual([A, B, C])
  })

  it('drops entries that are not http(s) URLs instead of breaking every read', () => {
    expect(parseRpcUrls(`VITE_RPC_URLS=${A}`, ` "${B}" ,${C},wss://rpc.monad.xyz`)).toEqual([C])
  })
})
