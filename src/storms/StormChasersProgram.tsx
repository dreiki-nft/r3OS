import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from 'react'
import { blockEta, getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { painterName, usePainterNames } from '../chain/names'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { Button } from '../os/ui/Button'
import { Icon } from '../os/ui/Icon'
import {
  currentOrNextStorm,
  findWallet,
  isAddress,
  parseBoard,
  rankBoard,
  type Board,
  type BoardRow,
} from './stormBoard'
import './storms.css'

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; board: Board }

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

function countdown(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
}

export function StormChasersProgram() {
  usePainterNames()
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [text, setText] = useState('')
  const [lookup, setLookup] = useState<string>()
  const [bad, setBad] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/storms/season-1.json', { cache: 'no-cache', signal: controller.signal })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
      )
      .then((json) => setLoad({ state: 'ready', board: parseBoard(json) }))
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ state: 'error' })
      })
    return () => controller.abort()
  }, [])

  const rows = useMemo(() => (load.state === 'ready' ? rankBoard(load.board.wallets) : []), [load])
  const target = lookup ?? wallet.account
  const mine = findWallet(rows, target)

  function check(event: FormEvent) {
    event.preventDefault()
    const value = text.trim()
    if (!isAddress(value)) {
      setBad(true)
      return
    }
    setBad(false)
    setLookup(value)
  }

  if (load.state !== 'ready')
    return (
      <div className="storms-program">
        <p className="storms-note">
          {load.state === 'loading'
            ? 'Loading the storm chasers…'
            : 'Could not load the leaderboard. Try again in a moment.'}
        </p>
      </div>
    )

  const { board } = load
  const done = board.storms.length
  const counted = Math.max(0, ...board.storms.map((storm) => storm.number))
  const tickets = rows.reduce((sum, row) => sum + row.tickets, 0)
  const next = currentOrNextStorm(block.block)
  const live = block.block > 0n

  return (
    <div className="storms-program">
      <div className="storms-head">
        <span className="storms-tag">
          {done} OF {board.totalStorms} STORMS
        </span>
        <span className="storms-count">
          {tickets} tickets · {rows.length} wallets
        </span>
      </div>

      <div className="storms-strip" aria-label={`${done} of ${board.totalStorms} storms done`}>
        {Array.from({ length: board.totalStorms }, (_, i) => {
          const number = i + 1
          const isCounted = board.storms.some((storm) => storm.number === number)
          const caught = mine?.storms?.includes(number)
          const isNext = live && next.number === number
          return (
            <i
              key={number}
              className={[isCounted && 'done', caught && 'caught', isNext && (next.now ? 'now' : 'next')]
                .filter(Boolean)
                .join(' ')}
              title={`storm ${number}${caught ? ' · you caught it' : isCounted ? ' · counted' : ''}`}
            />
          )
        })}
      </div>

      <div className={next.now && live ? 'storms-next now' : 'storms-next'}>
        <Icon name="lightning" size={18} colour="#FEC343" />
        {!live ? (
          <span>waiting for the chain…</span>
        ) : next.now ? (
          <span>
            <b>STORM {next.number ?? ''} IS ON</b> · paint now, ends in{' '}
            {countdown(blockEta(block.stormEndsIn))}
          </span>
        ) : next.number ? (
          <span>
            storm {next.number} in <b>{countdown(blockEta(block.nextStormIn))}</b> · block{' '}
            {next.start.toLocaleString('en-US')}
          </span>
        ) : (
          <span>all {board.totalStorms} season storms are done</span>
        )}
      </div>

      <form className="storms-check" onSubmit={check}>
        <input
          value={text}
          onChange={(event) => {
            setText(event.target.value)
            setBad(false)
          }}
          placeholder="paste any wallet address"
          spellCheck={false}
          autoComplete="off"
          aria-label="Wallet address"
          aria-invalid={bad}
        />
        <Button type="submit" disabled={!text.trim()}>
          Check
        </Button>
      </form>

      <Mine
        target={target}
        row={mine}
        bad={bad}
        pasted={lookup != null}
        onClear={() => (setLookup(undefined), setText(''))}
      />

      <div className="storms-table sunken">
        <table>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.address}
                className={row === mine ? (lookup ? 'me' : 'me you') : row.rank === 1 ? 'top' : undefined}
              >
                <td className="rank">#{row.rank}</td>
                <td className="who" title={row.address}>
                  <span className="name">{painterName(row.address)}</span>
                  <span className="addr">{short(row.address)}</span>
                </td>
                <td className="pips" aria-hidden="true">
                  {Array.from({ length: Math.min(row.tickets, board.totalStorms) }, (_, i) => (
                    <b key={i} />
                  ))}
                </td>
                <td className="t">{row.tickets}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="storms-note">No storm chasers yet. Be the first.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="storms-rule">
        Paint 1 pixel during a DF1 storm = <b>1 ticket</b> for the end-of-season r3tard raffle.
      </p>
      <p className="storms-note">Counted through storm {counted}. The board updates after each storm.</p>
    </div>
  )
}

function Mine({
  target,
  row,
  bad,
  pasted,
  onClear,
}: {
  target?: string
  row?: BoardRow
  bad: boolean
  pasted: boolean
  onClear: () => void
}) {
  if (bad) return <div className="storms-mine">That is not a wallet address (0x… with 40 characters).</div>
  if (!target)
    return (
      <div className="storms-mine dim">Connect your wallet, or paste an address, to see your tickets.</div>
    )
  return (
    <div className={row ? 'storms-mine hit' : 'storms-mine'}>
      <div>
        <b>{pasted ? painterName(target) : 'You'}</b> <span className="addr">{short(target)}</span>
        {pasted && (
          <button type="button" className="storms-clear" onClick={onClear} aria-label="Back to my wallet">
            ×
          </button>
        )}
      </div>
      {row ? (
        <div>
          <span className="big">{row.tickets}</span> {row.tickets === 1 ? 'ticket' : 'tickets'} · rank #
          {row.rank}
          {row.storms?.length ? <> · caught storm {row.storms.join(', ')}</> : null}
        </div>
      ) : (
        <div>No tickets yet. Paint 1 pixel during the next storm to get one.</div>
      )}
    </div>
  )
}
