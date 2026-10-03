import { describe, expect, it } from 'vitest'
import { countRpc, resetRpcStats, rpcStatsSnapshot, rpcStatsTotalSnapshot } from './rpcStats'

describe('rpc stats', () => {
  it('counts calls by method in development', () => {
    resetRpcStats()
    countRpc('eth_call')
    countRpc('eth_call')
    countRpc('eth_blockNumber')
    const stats = rpcStatsSnapshot()
    expect(stats.eth_call).toBe(2)
    expect(stats.eth_blockNumber).toBe(1)
    expect(rpcStatsTotalSnapshot()).toEqual({ eth_call: 2, eth_blockNumber: 1 })
  })
})
