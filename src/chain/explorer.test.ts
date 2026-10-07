import { describe, expect, it } from 'vitest'
import type { Hex } from 'viem'
import { explorerBaseUrl, transactionExplorerUrl } from './explorer'

const hash = `0x${'12'.repeat(32)}` as Hex

describe('explorer links', () => {
  it('uses MonadVision on Monad mainnet without depending on VITE_EXPLORER_URL', () => {
    expect(explorerBaseUrl(143)).toBe('https://monadvision.com')
    expect(transactionExplorerUrl(hash, 143)).toBe(`https://monadvision.com/tx/${hash}`)
  })

  it('uses MonadVision testnet on Monad testnet', () => {
    expect(explorerBaseUrl(10143)).toBe('https://testnet.monadvision.com')
    expect(transactionExplorerUrl(hash, 10143)).toBe(`https://testnet.monadvision.com/tx/${hash}`)
  })
})
