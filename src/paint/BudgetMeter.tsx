import { Button } from '../os/ui/Button'
import { ProgressSegments } from '../os/ui/ProgressSegments'

export interface BudgetState {
  hourly: number
  hourlyLimit: number
  holder: number
  total: number
  activeDays: number
}

export function BudgetMeter({
  budget,
  cost,
  reason,
  connected = true,
  onHolderQuota,
}: {
  budget: BudgetState
  cost: number
  reason?: string
  connected?: boolean
  onHolderQuota?: () => void
}) {
  if (!connected) {
    return (
      <div className="budget-meter">
        <span>connect to see your budget</span>
        <ProgressSegments value={0} max={1} />
      </div>
    )
  }

  const left = Math.max(0, budget.total - cost)
  const limit = Math.max(1, budget.hourlyLimit + budget.holder)
  return (
    <div className="budget-meter">
      <span>
        budget left this hour: {left} / {limit} px
      </span>
      <ProgressSegments value={left} max={limit} />
      <small>
        {reason ?? `${budget.hourlyLimit} hourly + ${budget.holder} holder · trust ${budget.activeDays}`}
      </small>
      {onHolderQuota && <Button onClick={onHolderQuota}>Holder quota…</Button>}
    </div>
  )
}
