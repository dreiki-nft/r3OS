import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { addressExplorerUrl } from '../chain/explorer'
import { formatStranded, loadStrandedBurners, strandedTotal, type StrandedBurner } from './sessionHistory'

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

/** This wallet's Live Mode burners from other browsers that still hold MON (src/live/sessionHistory.ts). */
export function useStrandedBurners(owner?: Address, current?: Address, refresh = 0) {
  const [rows, setRows] = useState<StrandedBurner[]>([])
  useEffect(() => {
    if (!owner) {
      setRows([])
      return
    }
    let cancelled = false
    void loadStrandedBurners(owner, current).then((next) => {
      if (!cancelled) setRows(next)
    })
    return () => {
      cancelled = true
    }
  }, [owner, current, refresh])
  return rows
}

/**
 * "You have MON in Live Mode wallets from another browser": where it is and how to get it back. Renders
 * nothing when there is none. `compact` is the one-line warning for the Live Mode wizard.
 */
export function StrandedBurners({
  owner,
  current,
  refresh,
  compact = false,
}: {
  owner?: Address
  current?: Address
  refresh?: number
  compact?: boolean
}) {
  const rows = useStrandedBurners(owner, current, refresh)
  if (!rows.length) return null
  const total = formatStranded(strandedTotal(rows))
  const wallets = `${rows.length} Live Mode wallet${rows.length === 1 ? '' : 's'}`
  if (compact)
    return (
      <p className="dialog-warning stranded-burners-note">
        You already have {total} in {wallets} from another browser or device. A new burner here can't reach
        it: open r3OS where you started that session and use My Pass › Hardware Profiles › Sweep leftover MON.
      </p>
    )
  return (
    <div className="stranded-burners sunken" role="note">
      <b>
        {total} in {wallets} from another browser
      </b>
      <p>
        Each Live Mode wallet lives only in the browser that made it, and only that browser can send its MON
        back. Open r3OS in the browser or on the device where you started that session, connect this wallet,
        and use <b>Sweep leftover MON…</b> here. If you cleared that browser's data or used a private window,
        the key is gone and that MON can't be moved by anyone.
      </p>
      <ul>
        {rows.map((row) => {
          const href = addressExplorerUrl(row.address)
          return (
            <li key={row.address}>
              {href ? (
                <a href={href} target="_blank" rel="noreferrer">
                  {short(row.address)}
                </a>
              ) : (
                short(row.address)
              )}{' '}
              · {formatStranded(row.balance)} · started at block {row.startedBlock.toLocaleString('en-US')}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
