import { useEffect, useState, useSyncExternalStore } from 'react'
import { getActionRpcSnapshot, probeActionRpcs, subscribeActionRpc } from '../chain/actionRpc'
import { blockEta, getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { config } from '../chain/config'
import { readCoreConstants } from '../chain/contracts'
import { addressExplorerUrl } from '../chain/explorer'
import { seasonClock } from '../lib/seasonClock'
import { getPresenceSnapshot, PRESENCE_WINDOW_BLOCKS, subscribePresence, summarize } from '../paint/presence'
import { openProgram } from '../os/programs'
import { Button } from '../os/ui/Button'
import { currentOrNextStorm } from '../storms/stormBoard'
import { LEVEL_TEXT, ago, chainLevel, overall, rpcSummary, type Level } from './statusModel'
import './status.css'

type Fresh = { storms?: { at: number; counted: number }; season?: { at: number } }

function Light({ level }: { level: Level }) {
  return <i className={`status-light ${level}`} aria-label={level} />
}

function Line({ level, label, children }: { level?: Level; label: string; children: React.ReactNode }) {
  return (
    <div className="status-line">
      {level ? <Light level={level} /> : <span className="status-light-spacer" />}
      <b>{label}</b>
      <span>{children}</span>
    </div>
  )
}

function duration(ms: number) {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 1) return 'under a minute'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} d ${h % 24} h`
}

export function StatusProgram() {
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const rpc = useSyncExternalStore(subscribeActionRpc, getActionRpcSnapshot)
  const presence = useSyncExternalStore(subscribePresence, getPresenceSnapshot)
  const [now, setNow] = useState(Date.now())
  const [fresh, setFresh] = useState<Fresh>({})
  const [season, setSeason] = useState<string>()

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    // One read-only ping per endpoint so the RPC line isn't empty on a fresh tab.
    if (!getActionRpcSnapshot().endpoints.some((endpoint) => endpoint.samples > 0)) void probeActionRpcs()
    void readCoreConstants()
      .then((constants) =>
        // demo/local builds have no season start: say nothing rather than a made-up season number
        constants.SEASON_START > 0n
          ? setSeason(seasonClock(Date.now() / 1_000, constants)?.label)
          : undefined,
      )
      .catch(() => undefined)
    const read = (path: string) =>
      fetch(path, { cache: 'no-cache' })
        .then((response) => (response.ok ? response.json() : undefined))
        .catch(() => undefined)
    void Promise.all([read('/storms/season-1.json'), read('/season/painters.json')]).then(
      ([storms, painters]) =>
        setFresh({
          storms:
            storms?.updatedAt != null
              ? {
                  at: Date.parse(storms.updatedAt),
                  counted: Math.max(0, ...(storms.storms ?? []).map((s: { number: number }) => s.number)),
                }
              : undefined,
          season: painters?.asOf ? { at: Date.parse(painters.asOf) } : undefined,
        }),
    )
  }, [])

  const blockAge =
    block.block > 0n && block.timestamp > 0n ? now - Number(block.timestamp) * 1_000 : undefined
  const chain = chainLevel(blockAge, block.mode)
  const rpcState = rpcSummary(rpc.endpoints, now)
  const level = overall([chain, rpcState.level])

  const recent = summarize(presence.strokes, block.block, PRESENCE_WINDOW_BLOCKS)
  const lastStroke = presence.strokes.reduce((max, stroke) => (stroke.block > max ? stroke.block : max), 0n)
  const lastPaintMs =
    lastStroke > 0n && block.block >= lastStroke
      ? Number(block.block - lastStroke) * block.blockTimeMs
      : undefined
  const storm = currentOrNextStorm(block.block)

  return (
    <div className="status-program">
      <div className={`status-banner ${level}`}>
        <Light level={level} />
        <div>
          <strong>{LEVEL_TEXT[level]}</strong>
          <small>checked live from this browser · {new Date(now).toLocaleTimeString()}</small>
        </div>
      </div>

      <section className="status-group">
        <h3>Monad</h3>
        <Line level={chain} label="Chain">
          {block.block > 0n ? (
            <>
              block #{block.block.toLocaleString('en-US')}
              {blockAge != null && <> · {blockAge < 2_000 ? 'just now' : ago(blockAge)}</>}
            </>
          ) : (
            'waiting for the first block…'
          )}
        </Line>
        <Line label="Block time">
          {block.block > 0n ? `${(block.blockTimeMs / 1000).toFixed(2)} s (measured here)` : '—'}
        </Line>
        <Line
          level={block.mode === 'live' ? 'ok' : block.mode === 'polling' ? 'degraded' : 'down'}
          label="Live feed"
        >
          {block.mode === 'live'
            ? 'websocket, new blocks arrive as they happen'
            : block.mode === 'polling'
              ? 'polling (slower updates)'
              : 'offline'}
        </Line>
        <Line level={rpcState.level} label="RPC">
          {rpcState.total === 0
            ? 'none configured'
            : `${rpcState.healthy} of ${rpcState.total} endpoints healthy${rpcState.best != null ? ` · fastest ${Math.round(rpcState.best)} ms` : ''}`}
        </Line>
      </section>

      <section className="status-group">
        <h3>Canvas</h3>
        <Line label="Painting now">
          {recent.painters
            ? `${recent.painters} ${recent.painters === 1 ? 'painter' : 'painters'} in the last minute`
            : 'nobody in the last minute'}
        </Line>
        <Line label="Last paint">
          {lastPaintMs != null ? (lastPaintMs < 2_000 ? 'just now' : ago(lastPaintMs)) : '—'}
        </Line>
        <Line label="Storms">
          {block.block === 0n
            ? '—'
            : storm.now
              ? `storm ${storm.number ?? ''} is ON · ends in ${duration(blockEta(block.stormEndsIn))}`
              : storm.number
                ? `storm ${storm.number} in ${duration(blockEta(block.nextStormIn))} · block ${storm.start.toLocaleString('en-US')}`
                : 'no storms left this season'}
        </Line>
        <Line label="Season">{season ?? '—'}</Line>
      </section>

      <section className="status-group">
        <h3>Published data</h3>
        <Line
          level={fresh.storms ? (now - fresh.storms.at < 30 * 3_600_000 ? 'ok' : 'degraded') : undefined}
          label="Storm board"
        >
          {fresh.storms
            ? `counted through storm ${fresh.storms.counted} · updated ${ago(now - fresh.storms.at)}`
            : '—'}
        </Line>
        <Line label="Season numbers">{fresh.season ? `updated ${ago(now - fresh.season.at)}` : '—'}</Line>
      </section>

      <section className="status-group">
        <h3>Contracts</h3>
        <Line label="Paint">
          {config.paintAddress ? (
            <a href={addressExplorerUrl(config.paintAddress)} target="_blank" rel="noreferrer">
              {config.paintAddress.slice(0, 8)}…{config.paintAddress.slice(-6)}
            </a>
          ) : (
            'demo'
          )}{' '}
          · Monad mainnet ({config.chainId})
        </Line>
      </section>

      <div className="status-actions">
        <Button onClick={() => void probeActionRpcs()}>Check RPC again</Button>
        <Button onClick={() => void openProgram('dxdiag')}>Full diagnostics (DXDIAG)</Button>
      </div>
      <p className="status-note">
        Everything here is read by your own browser, so it also tells you whether r3OS works from where you
        are. No addresses of private endpoints are shown.
      </p>
    </div>
  )
}
