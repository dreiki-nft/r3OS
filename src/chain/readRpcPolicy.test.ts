import { describe, expect, it } from 'vitest'
import {
  PUBLIC_RPC_RANK_INTERVAL_MS,
  PUBLIC_RPC_RANK_TIMEOUT_MS,
  PUBLIC_RPC_RETRY_COUNT,
  PUBLIC_RPC_TIMEOUT_MS,
  publicRpcWorstCaseSingleEndpointMs,
} from './readRpcPolicy'

describe('public read RPC policy', () => {
  it('fails over instead of retrying one provider for seconds', () => {
    expect(PUBLIC_RPC_RETRY_COUNT).toBe(0)
    expect(PUBLIC_RPC_TIMEOUT_MS).toBeLessThanOrEqual(2_500)
    expect(publicRpcWorstCaseSingleEndpointMs()).toBe(PUBLIC_RPC_TIMEOUT_MS)
  })

  it('ranks providers without turning ranking into background RPC spam', () => {
    expect(PUBLIC_RPC_RANK_TIMEOUT_MS).toBeLessThan(PUBLIC_RPC_TIMEOUT_MS)
    expect(PUBLIC_RPC_RANK_INTERVAL_MS).toBeGreaterThanOrEqual(30_000)
  })
})
