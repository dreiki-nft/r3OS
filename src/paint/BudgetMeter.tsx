import { Button } from '../os/ui/Button'
import { ProgressSegments } from '../os/ui/ProgressSegments'
import type { GasHint } from './gasHint'

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
  gas,
  onHolderQuota,
}: {
  budget: BudgetState
  cost: number
  reason?: string
  connected?: boolean
  /** "Need MON?": the wallet can't pay for the next stroke (or soon won't). Say so before Paint fails. */
  gas?: GasHint
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
      {gas?.kind === 'empty' && gas.network === 'testnet' && (
        <small className="budget-gas-hint">
          your wallet has 0 MON for gas.{' '}
          <a href="https://faucet.monad.xyz" target="_blank" rel="noopener noreferrer">
            get free test MON
          </a>
        </small>
      )}
      {gas?.kind === 'empty' && gas.network === 'mainnet' && (
        <small className="budget-gas-hint">
          need MON? your wallet has 0 MON for gas
          {gas.perStroke ? `; one stroke costs up to ${gas.perStroke} right now` : ''}. send a little MON to
          your wallet from any wallet or exchange that supports Monad.
        </small>
      )}
      {gas?.kind === 'short' && (
        <small className="budget-gas-hint">
          not enough MON for this stroke: it can cost up to {gas.perStroke}, you have {gas.balance}. top up
          this wallet, or paint a smaller stroke.
        </small>
      )}
      {gas?.kind === 'low' && (
        <small className="budget-gas-hint">
          low on MON: about {gas.strokes} more stroke{gas.strokes === 1 ? '' : 's'} at {gas.perStroke} each.
        </small>
      )}
      {onHolderQuota && <Button onClick={onHolderQuota}>Holder quota…</Button>}
    </div>
  )
}
