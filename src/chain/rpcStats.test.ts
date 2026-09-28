import { describe, expect, it } from 'vitest'
import { countRpc, resetRpcStats, rpcStatsSnapshot } from './rpcStats'

describe('rpc stats', () => {
  it('counts calls by method in development', () => {
    resetRpcStats()
    countRpc('eth_call')
    countRpc('eth_call')
    countRpc('eth_blockNumber')
    const stats = rpcStatsSnapshot()
    expect(stats.eth_call).toBe(2)
    expect(stats.eth_blockNumber).toBe(1)
  })
})
