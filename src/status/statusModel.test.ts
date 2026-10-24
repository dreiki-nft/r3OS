import { describe, expect, it } from 'vitest'
import { ago, chainLevel, overall, rpcSummary } from './statusModel'

const ep = (over: Partial<Parameters<typeof rpcSummary>[0][number]> = {}) => ({
  index: 0,
  samples: 5,
  successes: 5,
  failures: 0,
  consecutiveFailures: 0,
  ewmaMs: 200,
  ...over,
})

describe('status', () => {
  it('judges the chain by the age of the newest block', () => {
    expect(chainLevel(800, 'live')).toBe('ok')
    expect(chainLevel(800, 'polling')).toBe('degraded')
    expect(chainLevel(15_000, 'live')).toBe('degraded')
    expect(chainLevel(90_000, 'live')).toBe('down')
    expect(chainLevel(undefined, 'live')).toBe('starting')
    expect(chainLevel(undefined, 'offline')).toBe('down')
  })

  it('counts RPC endpoints without naming them', () => {
    expect(rpcSummary([ep(), ep({ index: 1, ewmaMs: 150 })])).toMatchObject({
      level: 'ok',
      healthy: 2,
      best: 150,
    })
    expect(rpcSummary([ep(), ep({ index: 1, consecutiveFailures: 2 })])).toMatchObject({
      level: 'degraded',
      healthy: 1,
      failing: 1,
    })
    expect(rpcSummary([ep({ consecutiveFailures: 1 })]).level).toBe('down')
    expect(rpcSummary([ep({ samples: 0, ewmaMs: undefined })]).level).toBe('starting')
    expect(rpcSummary([]).level).toBe('down')
  })

  it('takes the worst level and words ages plainly', () => {
    expect(overall(['ok', 'degraded', 'ok'])).toBe('degraded')
    expect(overall(['ok', 'starting'])).toBe('starting')
    expect(overall(['down', 'degraded'])).toBe('down')
    expect(ago(4_000)).toBe('4 s ago')
    expect(ago(125 * 60_000)).toBe('2 h 5 min ago')
    expect(ago(3 * 86_400_000)).toBe('3 days ago')
  })
})
