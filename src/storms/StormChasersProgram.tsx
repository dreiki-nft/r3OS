import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from 'react'
import { blockEta, getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { painterName, usePainterNames } from '../chain/names'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { openProgram } from '../os/programs'
import { Button } from '../os/ui/Button'
import { Icon } from '../os/ui/Icon'
import { Tabs } from '../os/ui/Tabs'
import {
  SEASON_FIRST_STORM,
  currentOrNextStorm,
  estimatedHead,
  findWallet,
  isAddress,
  parseBoard,
  rankBoard,
  stormsIcs,
  upcomingStorms,
  type Board,
  type BoardRow,
} from './stormBoard'
import {
  getStormLiveVersion,
  loadStorm,
  stormPainters,
  subscribeStormLive,
  uncountedStorms,
} from './stormLive'
import { cardHeadline, shareCard, type CardData } from './shareCard'
import './storms.css'

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; board: Board }

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

function countdown(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export function StormChasersProgram() {
  usePainterNames()
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [text, setText] = useState('')
  const [lookup, setLookup] = useState<string>()
  const [bad, setBad] = useState(false)
  const [tab, setTab] = useState('Leaderboard')
  const [picked, setPicked] = useState<number>()
  useSyncExternalStore(subscribeStormLive, getStormLiveVersion)

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
  const countedThrough =
    load.state === 'ready' ? Math.max(0, ...load.board.storms.map((storm) => storm.number)) : 0
  const totalStorms = load.state === 'ready' ? load.board.totalStorms : 21
  // Storms the file hasn't counted yet (running now, or ended before the next refresh), read live from the chain.
  const fresh =
    load.state === 'ready' && block.block > 0n
      ? uncountedStorms(block.block, countedThrough, SEASON_FIRST_STORM, totalStorms)
      : []
  const freshKey = fresh.map((storm) => storm.start).join(',')
  useEffect(() => {
    for (const storm of fresh) void loadStorm(storm.start)
  }, [freshKey])
  const pending = target
    ? fresh
        .filter((storm) => stormPainters(storm.start).has(target.toLowerCase()))
        .map((storm) => storm.number)
    : []

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
  const counted = countedThrough
  const shown = picked ? rows.filter((row) => row.storms?.includes(picked)) : rows
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
          const isFresh = fresh.some((storm) => storm.number === number)
          const caughtFresh = pending.includes(number)
          return (
            <i
              key={number}
              role={isCounted ? 'button' : undefined}
              tabIndex={isCounted ? 0 : undefined}
              onClick={() => isCounted && setPicked((value) => (value === number ? undefined : number))}
              onKeyDown={(event) => {
                if (isCounted && (event.key === 'Enter' || event.key === ' '))
                  setPicked((value) => (value === number ? undefined : number))
              }}
              className={[
                isCounted && 'done',
                (caught || caughtFresh) && 'caught',
                isFresh && !caughtFresh && 'fresh',
                isNext && (next.now ? 'now' : 'next'),
                picked === number && 'picked',
              ]
                .filter(Boolean)
                .join(' ')}
              title={`storm ${number}${caught || caughtFresh ? ' · you caught it' : isCounted ? ' · tap to see who caught it' : ''}`}
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

      {fresh.map((storm) => {
        const chasers = stormPainters(storm.start).size
        const caught = pending.includes(storm.number)
        return (
          <div key={storm.number} className={caught ? 'storms-live caught' : 'storms-live'}>
            <b>
              storm {storm.number} {storm.live ? 'live' : 'just ended'}
            </b>
            : {chasers} {chasers === 1 ? 'chaser' : 'chasers'} so far ·{' '}
            {!target
              ? 'connect to see yours'
              : caught
                ? `${lookup ? 'caught it' : "you're in"} ✓ +1 ticket (on the board after the next update)`
                : storm.live
                  ? lookup
                    ? 'not yet'
                    : 'not yet: paint 1 pixel now'
                  : 'not caught'}
          </div>
        )
      })}

      <Tabs tabs={['Leaderboard', 'Schedule']} active={tab} onChange={setTab} />
      {tab === 'Schedule' ? (
        <Schedule head={block.block} />
      ) : (
        <>
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
            pending={pending}
            onClear={() => (setLookup(undefined), setText(''))}
            card={
              target && (mine || pending.length)
                ? {
                    name: painterName(target),
                    address: target,
                    tickets: mine?.tickets ?? 0,
                    pending: pending.length,
                    rank: mine?.rank,
                    wallets: rows.length,
                    caught: mine?.storms ?? [],
                    pendingStorms: pending,
                    counted,
                    totalStorms: board.totalStorms,
                  }
                : undefined
            }
          />

          {picked && (
            <div className="storms-picked">
              storm {picked}: {shown.length} {shown.length === 1 ? 'chaser' : 'chasers'} caught it ·{' '}
              <button className="link-button" onClick={() => setPicked(undefined)}>
                show everyone
              </button>
            </div>
          )}

          <div className="storms-table sunken">
            <table>
              <tbody>
                {shown.map((row) => (
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
            Paint 1 pixel during a DF1 storm = <b>1 ticket</b> for the end-of-season r3tard raffle.{' '}
            <button className="link-button" onClick={() => void openProgram('raffle')}>
              how the draw works
            </button>
          </p>
          <p className="storms-note">
            Counted through storm {counted}. The board updates after each storm; tap a storm square to see who
            caught it.
          </p>
        </>
      )}
    </div>
  )
}

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

function Schedule({ head }: { head: bigint }) {
  const now = Date.now()
  // Before the first block arrives (or if the chain can't be reached), estimate the head from the clock.
  const list = upcomingStorms(head > 0n ? head : estimatedHead(now), now)
  if (!list.length) return <p className="storms-note">All season storms are done.</p>
  const download = () => {
    const blob = new Blob([stormsIcs(list, now)], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'r3os-storms.ics'
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  return (
    <div className="storms-schedule">
      <Button primary onClick={download}>
        Add {list.length === 1 ? 'the last storm' : `all ${list.length} storms`} to my calendar
      </Button>
      <div className="storms-table sunken">
        <table>
          <tbody>
            {list.map((storm) => (
              <tr key={storm.number}>
                <td className="rank">#{storm.number}</td>
                <td className="who">
                  <span className="name">{when(storm.at)}</span>
                  <span className="addr">block {storm.start.toLocaleString('en-US')}</span>
                </td>
                <td className="t">{storm.at <= now ? 'now' : countdown(storm.at - now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="storms-note">
        Times are in your time zone, estimated from Monad's block speed, so the far ones can move by a few
        minutes. The countdown at the top is exact. Each storm lasts 600 blocks (about 3 minutes).
      </p>
    </div>
  )
}

function Mine({
  target,
  row,
  bad,
  pasted,
  pending,
  onClear,
  card,
}: {
  target?: string
  row?: BoardRow
  bad: boolean
  pasted: boolean
  pending: number[]
  onClear: () => void
  card?: CardData
}) {
  const [shared, setShared] = useState<string>()
  const share = async (download = false) => {
    if (!card) return
    setShared('making…')
    try {
      const result = await shareCard(card, { download })
      setShared(result === 'downloaded' ? 'saved' : result === 'shared' ? 'shared' : undefined)
    } catch {
      setShared('failed')
    }
  }
  const xText = card
    ? `${cardHeadline(card)} in r3OS Storm Season ⚡\n\npaint 1 pixel during a DF1 storm = 1 raffle ticket\n\nr3os.app/#/storms`
    : ''
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
          {pending.length ? (
            <>
              {' '}
              · +{pending.length} pending (storm {pending.join(', ')})
            </>
          ) : null}
        </div>
      ) : pending.length ? (
        <div>
          <span className="big">+{pending.length}</span> pending: caught storm {pending.join(', ')}, on the
          board after the next update
        </div>
      ) : (
        <div>No tickets yet. Paint 1 pixel during the next storm to get one.</div>
      )}
      {card && (
        <div className="storms-share">
          <Button onClick={() => void share()} disabled={shared === 'making…'}>
            {shared === 'making…' ? 'Making the card…' : 'Share my storm card'}
          </Button>
          {shared === 'saved' && (
            <span>
              card downloaded ·{' '}
              <a
                href={`https://x.com/intent/post?text=${encodeURIComponent(xText)}`}
                target="_blank"
                rel="noreferrer"
              >
                post on X
              </a>{' '}
              and attach it
            </span>
          )}
          {shared === 'shared' && (
            <button type="button" className="storms-link" onClick={() => void share(true)}>
              download the image instead
            </button>
          )}
          {shared === 'failed' && <span>couldn't make the image in this browser</span>}
        </div>
      )}
    </div>
  )
}
