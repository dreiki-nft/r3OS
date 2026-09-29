import './phase4a.css'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Address } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { getFrameInfoBatch, getFramesSnapshot, refreshFrameIndex } from '../frames/framesStore'
import { closeWindow } from '../os/windows'
import { Button } from '../os/ui/Button'
import { Icon } from '../os/ui/Icon'
import { IntroBar } from '../os/ui/IntroBar'
import { MenuBar } from '../os/ui/MenuBar'
import { playSound } from '../os/sound'
import { shortAddress } from '../labs/labCommon'
import {
  BACKFILL_COUNT,
  PRODUCER_WINDOW,
  appendHeader,
  backfillHeaders,
  framesByProducer,
  heartbeatPath,
  producerColour,
  producerStats,
  trimHeaderWindow,
  type ProducerHeader,
} from './network'

const RULES = [
  "each block header carries its producer's address (the coinbase). we count them over the last 2,000 blocks (~10 min).",
  'saved frames record the producer of the block they were saved in. that is the frames count.',
  "addresses only, no names. until monad documents how it fills the coinbase, treat it as the block's fee recipient, not a verified validator identity.",
] as const

const headerCache = new Map<bigint, ProducerHeader>()

function cacheRows(rows: readonly ProducerHeader[]) {
  for (const row of rows) headerCache.set(row.number, row)
  const ordered = [...headerCache.keys()].sort((a, b) => (a < b ? -1 : 1))
  while (ordered.length > PRODUCER_WINDOW) headerCache.delete(ordered.shift()!)
}

function cachedRows() {
  return trimHeaderWindow([...headerCache.values()])
}

export function NetworkProgram() {
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const [headers, setHeaders] = useState<ProducerHeader[]>(cachedRows)
  const [frameCounts, setFrameCounts] = useState<Map<string, number>>(new Map())
  const [selected, setSelected] = useState<Address>()
  const [view, setView] = useState<'icons' | 'list'>('icons')
  const [properties, setProperties] = useState(false)
  const [loading, setLoading] = useState(true)
  const previousHead = useRef<bigint | undefined>(undefined)
  const backfillStarted = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    if (!publicClient) {
      setLoading(false)
      return
    }
    if (block.block <= 0n || backfillStarted.current) return
    backfillStarted.current = true
    const cached = cachedRows()
    if (cached.length >= BACKFILL_COUNT) {
      setHeaders(cached)
      setLoading(false)
      return
    }
    // The backfill outlives block changes (a new block arrives every ~0.3 s); only unmount cancels it.
    void backfillHeaders(publicClient as never, block.block, BACKFILL_COUNT, 8).then((rows) => {
      if (!mounted.current) return
      cacheRows(rows)
      setHeaders(cachedRows())
      setLoading(false)
    })
  }, [block.block])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!block.block) return
    const current: ProducerHeader = {
      number: block.block,
      timestamp: block.timestamp,
      miner: block.miner,
    }
    cacheRows([current])
    setHeaders((rows) => appendHeader(rows, current))

    const previous = previousHead.current
    previousHead.current = block.block
    if (!publicClient || previous == null || block.block <= previous + 1n) return
    const gap = Number(block.block - previous - 1n)
    if (gap <= 0) return
    void backfillHeaders(publicClient as never, block.block - 1n, Math.min(gap, PRODUCER_WINDOW), 8).then(
      (rows) => {
        cacheRows(rows)
        setHeaders(cachedRows())
      },
    )
  }, [block.block, block.timestamp, block.miner])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await refreshFrameIndex()
      const total = getFramesSnapshot().total
      if (!total) return
      const ids = Array.from({ length: total }, (_, index) => index + 1)
      const info = await getFrameInfoBatch(ids)
      if (!cancelled) setFrameCounts(framesByProducer(info.values()))
    })().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const stats = useMemo(() => producerStats(headers, frameCounts), [headers, frameCounts])
  const active = stats.find((item) => item.address.toLowerCase() === selected?.toLowerCase()) ?? stats[0]
  const maxBlocks = stats[0]?.blocks || 1
  const recent = headers.slice(-60)
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  const heartbeat = heartbeatPath(recent, reduced)
  const bpm = block.blockTimeMs > 0 ? Math.round(60_000 / block.blockTimeMs) : 200
  const blocksPerSecond = block.blockTimeMs > 0 ? (1000 / block.blockTimeMs).toFixed(2) : '—'

  return (
    <div className="lab-program phase4a-program network-program">
      <MenuBar
        menus={[
          { label: 'File', items: [{ label: 'Close', action: () => closeWindow('validators') }] },
          {
            label: 'Edit',
            items: [{ label: 'Properties', disabled: !active, action: () => setProperties(true) }],
          },
          {
            label: 'View',
            items: [
              { label: 'Icons', action: () => setView('icons') },
              { label: 'List', action: () => setView('list') },
            ],
          },
          { label: 'Help', items: [{ label: 'About block producers', action: () => undefined }] },
        ]}
      />

      <div className="network-toolbar">
        <button onClick={() => playSound('select')}>
          <span>‹</span>
          <small>Back</small>
        </button>
        <button onClick={() => playSound('select')}>
          <span>↑</span>
          <small>Up</small>
        </button>
        <i />
        <button onClick={() => setView((value) => (value === 'icons' ? 'list' : 'icons'))}>
          <Icon name="computer" size={24} />
          <small>Explorer</small>
        </button>
        <button disabled={!active} onClick={() => setProperties(true)}>
          <Icon name="info" size={24} />
          <small>Properties</small>
        </button>
      </div>
      <div className="network-address">
        <span>Address</span>
        <div className="sunken">
          <Icon name="globe" size={20} colour="#5FEDDF" />
          <span>Monad \ Network Neighborhood</span>
        </div>
      </div>

      <IntroBar
        lead="the validators producing Monad blocks, as seen by this app. every frame you save records which one made its block."
        monad="a new block every ~0.3 s from a rotating validator set. the heartbeat below beats once per block, ~200 BPM."
        rules={RULES}
      />

      <div className="network-main">
        <aside className="network-sidebar sunken">
          <div className="network-title">
            <Icon name="globe" size={36} colour="#5FEDDF" />
            <div>
              <b>Network Neighborhood</b>
              <span>block producers seen by this app</span>
            </div>
          </div>
          {active ? (
            <>
              <div className="network-current">
                <i style={{ background: producerColour(active.address) }} />
                <b>{shortAddress(active.address)}</b>
              </div>
              <div className="network-facts">
                <span>blocks, last 2,000</span>
                <b>
                  {active.blocks} ({(active.share * 100).toFixed(1)}%)
                </b>
                <span>frames saved</span>
                <b>{active.frames}</b>
              </div>
              <div className="network-share sunken">
                <i
                  style={{
                    width: `${(active.blocks / maxBlocks) * 100}%`,
                    background: producerColour(active.address),
                  }}
                />
              </div>
            </>
          ) : (
            <span className="muted">
              {loading ? 'finding block producers…' : 'no block producers seen yet'}
            </span>
          )}
        </aside>

        <section className={`network-list sunken ${view}`}>
          <button className="network-entire">
            <Icon name="computer" size={36} />
            <span>
              Entire network<small>{stats.length} seen</small>
            </span>
          </button>
          {stats.map((producer) => {
            const on = active?.address.toLowerCase() === producer.address.toLowerCase()
            return (
              <button
                key={producer.address}
                className={on ? 'selected' : ''}
                onClick={() => {
                  setSelected(producer.address)
                  playSound('select')
                }}
                onDoubleClick={() => {
                  setSelected(producer.address)
                  setProperties(true)
                }}
              >
                <span className="network-node">
                  <Icon name="computer" size={36} />
                  <i style={{ background: producerColour(producer.address) }} />
                </span>
                <span>
                  {shortAddress(producer.address)}
                  <small>
                    {producer.blocks} blocks · {producer.frames} frames
                  </small>
                </span>
              </button>
            )
          })}
        </section>
      </div>

      <fieldset className="network-heartbeat group-box">
        <legend>Heartbeat · {bpm} BPM · one beat per Monad block</legend>
        <svg viewBox="0 0 720 50" preserveAspectRatio="none" aria-label="heartbeat, one beat per block">
          <path d={heartbeat} fill="none" stroke="#c52020" strokeWidth="2" />
          {!reduced && heartbeat && (
            <circle cx="717" cy="30" r="4" fill="#c52020" className="heartbeat-blink" />
          )}
        </svg>
        <div className="producer-ticks" aria-label="producers of the last 60 blocks">
          {recent.map((header) => (
            <i key={header.number.toString()} style={{ background: producerColour(header.miner) }} />
          ))}
        </div>
        <small>last {recent.length} blocks, coloured by producer</small>
      </fieldset>

      <div className="phase4a-status">
        <span>
          {headers.length < PRODUCER_WINDOW
            ? `window fills as blocks arrive (${headers.length.toLocaleString()} / 2,000)`
            : `${stats.length} block producers in the last 2,000 blocks (~10 min)`}
        </span>
        <span>{blocksPerSecond} blocks/s</span>
        <span>#{block.block.toString()}</span>
      </div>

      {properties && active && (
        <div className="phase4a-modal" role="dialog" aria-label="Producer properties">
          <div className="phase4a-dialog raised">
            <b>Block producer properties</b>
            <div>
              <span>address</span>
              <code>{active.address}</code>
              <span>blocks in window</span>
              <b>{active.blocks}</b>
              <span>share</span>
              <b>{(active.share * 100).toFixed(2)}%</b>
              <span>frames saved</span>
              <b>{active.frames}</b>
              <span>last block seen</span>
              <b>#{active.lastBlock.toString()}</b>
            </div>
            <p>treat it as the block's fee recipient, not a verified validator identity.</p>
            {config.explorerUrl && (
              <a href={`${config.explorerUrl}/address/${active.address}`} target="_blank" rel="noreferrer">
                Open in explorer
              </a>
            )}
            <Button primary onClick={() => setProperties(false)}>
              OK
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
