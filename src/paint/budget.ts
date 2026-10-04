import type { BudgetState } from './BudgetMeter'

/**
 * Apply a confirmed Paint event to the budget snapshot already shown in the UI.
 * R3OSPaint spends hourly quota first, then holder/partner quota, so the browser can mirror
 * that deterministic accounting immediately and reconcile from chain after the burst settles.
 */
export function spendObservedBudget(budget: BudgetState, units: bigint | number): BudgetState {
  const requested = typeof units === 'bigint' ? Number(units) : units
  if (!Number.isFinite(requested) || requested <= 0) return budget

  let remaining = Math.max(0, Math.floor(requested))
  const fromHourly = Math.min(budget.hourly, remaining)
  remaining -= fromHourly
  const fromHolder = Math.min(budget.holder, remaining)

  const hourly = Math.max(0, budget.hourly - fromHourly)
  const holder = Math.max(0, budget.holder - fromHolder)
  return {
    ...budget,
    hourly,
    holder,
    total: hourly + holder,
  }
}
