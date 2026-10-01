import { describe, expect, it } from 'vitest'
import { encodeErrorResult } from 'viem'
import { R3TARDS_ROUTER_LAB_ABI } from '../lib/generated/abi'
import {
  decodeSimulationError,
  normalizeComparison,
  normalizeSimulationReport,
  traceLines,
} from './routerLab'
import { formatAmount, type RouterVenue } from './venues'

const A = '0x0000000000000000000000000000000000000001' as const
const B = '0x0000000000000000000000000000000000000002' as const
const C = '0x0000000000000000000000000000000000000003' as const
const venues: RouterVenue[] = [
  { label: 'mock', adapter: C, token0: A, token1: B, source: 'test', mock: true },
]

describe('router-lab frontend decoding', () => {
  it('normalizes Comparison tuples and formats the trace', () => {
    const comparison = normalizeComparison([
      100n,
      200n,
      A,
      B,
      1_000_000_000_000_000_000n,
      2_000_000n,
      0n,
      [[C, 0, 32_000n, 91_204n, 96n, '0x00000000', '0x', 0n, `0x${'00'.repeat(32)}`, 1, 80_000n]],
    ])
    expect(comparison.reports[0].amountOut).toBe(32_000n)
    expect(
      traceLines({
        comparison,
        venues,
        tokenInSymbol: 'WMON',
        tokenOutSymbol: 'USDC',
        amountText: '1',
        outputDecimals: 6,
        formatOutput: formatAmount,
      }).join('\n'),
    ).toContain('HIGHEST QUOTED OUTPUT')
  })

  it('normalizes Simulation reports', () => {
    expect(normalizeSimulationReport([C, 0, 100n, 1n, true, 99n, 2n, '0x00000000']).delivered).toBe(99n)
  })

  it('decodes the Simulation custom-error envelope', () => {
    const data = encodeErrorResult({
      abi: R3TARDS_ROUTER_LAB_ABI,
      errorName: 'Simulation',
      args: [55n, [[C, 0, 100n, 10n, true, 99n, 20n, '0x00000000']]],
    } as any)
    const decoded = decodeSimulationError(data)
    expect(decoded.blockNumber).toBe(55n)
    expect(decoded.reports[0].swapOk).toBe(true)
  })
})
