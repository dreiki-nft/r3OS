import { describe, expect, it } from 'vitest'
import {
  EXPECTED_MAINNET_CONTRACTS,
  extractCreatedContracts,
  formatAddressEnv,
  mergeDeploymentRuns,
} from './deployment-addresses-lib.mjs'

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`
const tx = (contractName: string, n: number) => ({ transactionType: 'CREATE', contractName, contractAddress: address(n) })

describe('mainnet deployment address collector', () => {
  it('collects exactly the intended 16 public deployment addresses across Foundry run files', () => {
    const runs = EXPECTED_MAINNET_CONTRACTS.map((name, i) => ({ run: { transactions: [tx(name, i + 1)] }, source: `run-${i}.json` }))
    const result = mergeDeploymentRuns(runs)
    expect(result.complete).toBe(true)
    expect(result.missing).toEqual([])
    expect(Object.keys(result.contracts)).toHaveLength(16)
    const env = formatAddressEnv(result)
    expect(env).toContain(`PAINT_ADDRESS=${address(1)}`)
    expect(env).not.toContain('PRIVATE_KEY')
    expect(env).not.toContain('RPC_URL')
  })

  it('ignores test/helper creations and reports partial deployment progress', () => {
    const run = { transactions: [tx('R3OSPaint', 1), tx('MockUSD', 2), { transactionType: 'CALL', contractName: 'R3OSLabs', contractAddress: address(3) }] }
    expect(extractCreatedContracts(run, 'core')).toEqual([{ contractName: 'R3OSPaint', address: address(1), source: 'core' }])
    const result = mergeDeploymentRuns([{ run, source: 'core' }])
    expect(result.complete).toBe(false)
    expect(result.contracts.R3OSPaint).toBe(address(1))
    expect(result.missing).toContain('R3OSLabs')
  })

  it('fails on conflicting addresses for the same production contract', () => {
    expect(() => mergeDeploymentRuns([
      { run: { transactions: [tx('R3OSPaint', 1)] }, source: 'a' },
      { run: { transactions: [tx('R3OSPaint', 2)] }, source: 'b' },
    ])).toThrow(/conflicting R3OSPaint addresses/)
  })
})
