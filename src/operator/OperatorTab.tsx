import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { decodeEventLog } from 'viem'
import { useOperatorRecord, recordRows, visibleSubsystems } from '../chain/operatorRecord'
import { useSystemEvent } from '../chain/systemEvent'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { R3TARDS_OPERATOR_RECORD_ABI } from '../lib/generated/abi'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { TreeView } from '../os/ui/TreeView'
import { OPERATOR_COPY } from './copy'
import './operator.css'

function SourceBadge({ source }: { source: string }) {
  return <small className={`operator-source operator-source-${source.toLowerCase()}`}>{source}</small>
}

export function OperatorTab() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const operator = useOperatorRecord(wallet.account)
  const systemEvent = useSystemEvent()
  const [quote, setQuote] = useState<ActionQuote>()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    setQuote(undefined)
    if (!wallet.account || !operator.driverAddress) return
    let cancelled = false
    void quoteAction({
      kind: 'estimate',
      address: operator.driverAddress,
      abi: R3TARDS_OPERATOR_RECORD_ABI,
      functionName: 'record',
      args: [wallet.account],
      account: wallet.account,
      action: OPERATOR_COPY.recordAction,
    })
      .then((next) => {
        if (!cancelled) setQuote(next)
      })
      .catch(() => {
        if (!cancelled) setQuote(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [wallet.account, operator.driverAddress, operator.record?.lastRecordBlock])

  const rows = useMemo(
    () => (operator.facts && operator.record ? recordRows(operator.facts, operator.record, systemEvent) : []),
    [operator.facts, operator.record, systemEvent],
  )

  async function recordNow() {
    if (!wallet.account || !operator.driverAddress || !quote || pending) return
    setPending(true)
    setMessage('')
    try {
      const result = await sendAction({
        kind: 'estimate',
        address: operator.driverAddress,
        abi: R3TARDS_OPERATOR_RECORD_ABI,
        functionName: 'record',
        args: [wallet.account],
        account: wallet.account,
        quote,
        action: OPERATOR_COPY.recordAction,
      })

      let addedMask = 0n
      let seasonAdded = false
      for (const log of result.receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: R3TARDS_OPERATOR_RECORD_ABI,
            data: log.data,
            topics: log.topics,
          })
          if (decoded.eventName !== 'OperatorRecorded') continue
          const args = decoded.args as any
          addedMask = BigInt(args.addedMask ?? 0)
          seasonAdded = Boolean(args.seasonAdded)
          break
        } catch {
          // Other logs in the receipt are expected.
        }
      }

      const added = visibleSubsystems()
        .filter((subsystem) => (addedMask & (1n << BigInt(subsystem.id))) !== 0n)
        .map((subsystem) => subsystem.label)
        .join(', ')
      if (!added && !seasonAdded) {
        setMessage(OPERATOR_COPY.nothingAdded)
      } else {
        const parts = []
        if (added) parts.push(`${OPERATOR_COPY.addedPrefix}: ${added}`)
        if (seasonAdded) parts.push(OPERATOR_COPY.seasonAdded)
        setMessage(parts.join(' · '))
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(false)
    }
  }

  if (!wallet.account) return <p>{OPERATOR_COPY.noWallet}</p>
  if (operator.status === 'no-driver') return <p>{OPERATOR_COPY.driverMissing}</p>

  return (
    <div className="operator-tab">
      <GroupBox title={OPERATOR_COPY.title}>
        {operator.loading || !operator.facts || !operator.record ? (
          <p>{OPERATOR_COPY.unknown}</p>
        ) : (
          <div>
            <div className="operator-rows">
              {rows.map((row) => (
                <div key={row.label}>
                  <span className="operator-label">{row.label}</span>
                  <i className="operator-leader" aria-hidden="true" />
                  <b className="operator-value">{String(row.value)}</b>
                  <SourceBadge source={row.source} />
                </div>
              ))}
            </div>

            <TreeView label={OPERATOR_COPY.subsystems}>
              {visibleSubsystems().map((subsystem) => {
                const answered = (operator.facts!.answeredMask & (1n << BigInt(subsystem.id))) !== 0n
                const used = answered ? subsystem.used(operator.facts!) : undefined
                const observed = operator.record!.firstObserved[subsystem.id] ?? 0n
                return (
                  <div role="treeitem" key={subsystem.id} className={used ? 'operator-used' : undefined}>
                    <span className="operator-subsystem">{subsystem.label}</span>
                    <small>
                      {used == null
                        ? OPERATOR_COPY.unknown
                        : used
                          ? OPERATOR_COPY.used
                          : OPERATOR_COPY.notUsed}
                      {' · '}
                      {observed ? `${OPERATOR_COPY.observedBy} ${observed}` : OPERATOR_COPY.notRecorded}
                    </small>
                  </div>
                )
              })}
            </TreeView>
          </div>
        )}
      </GroupBox>

      <p className="operator-note">{OPERATOR_COPY.publicLine}</p>
      <p className="operator-note">{OPERATOR_COPY.promiseLine}</p>

      <div className="operator-record-bar">
        <Button primary disabled={pending || !quote} onClick={() => void recordNow()}>
          {OPERATOR_COPY.recordButton}
        </Button>
        <small>
          {OPERATOR_COPY.maxCost}: {quote?.maxCost ?? OPERATOR_COPY.quoting}
        </small>
      </div>
      <p className="operator-note">{OPERATOR_COPY.recordHelp}</p>
      {message && <p>{message}</p>}
    </div>
  )
}
