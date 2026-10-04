import { describe, expect, it } from 'vitest'
import { spendObservedBudget } from './budget'

const budget = { hourly: 100, hourlyLimit: 512, holder: 200, total: 300, activeDays: 4 }

describe('spendObservedBudget', () => {
  it('mirrors the contract by spending hourly quota before holder quota', () => {
    expect(spendObservedBudget(budget, 80n)).toEqual({ ...budget, hourly: 20, total: 220 })
    expect(spendObservedBudget(budget, 150n)).toEqual({ ...budget, hourly: 0, holder: 150, total: 150 })
  })

  it('clamps a stale local snapshot at zero until chain reconciliation catches up', () => {
    expect(spendObservedBudget(budget, 500n)).toEqual({ ...budget, hourly: 0, holder: 0, total: 0 })
  })

  it('ignores non-positive observed usage', () => {
    expect(spendObservedBudget(budget, 0n)).toBe(budget)
  })
})
