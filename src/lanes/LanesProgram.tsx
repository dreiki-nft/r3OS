import '../network/phase4a.css'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Address, Log } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { publicClient, wsClient } from '../chain/clients'
import { discoverContracts } from '../chain/contracts'
import { subscribeMonadLogs, type MonadLogNotification } from '../chain/monadLogs'
import { closeWindow } from '../os/windows'
import { IntroBar } from '../os/ui/IntroBar'
import { MenuBar } from '../os/ui/MenuBar'
import {
  LANE_COUNT,
  buildLaneWindow,
  decodeLaneLogs,
  lanesFor,
  summarize,
  type LaneBlock,
  type LaneTx,
} from '../lib/lanes'
import { shortAddress } from '../labs/labCommon'
import { blockDetails, LANE_LABELS, mapLaneWindow, mergeLaneTxs } from './lanesView'

const RULES = [
  'rows are lanes: the 16 canvas regions, plus flipbook, mints and the other labs. columns are blocks, newest on the right (last 100, ~30 s).',
  "a paint only writes its own region's storage, so paints in different regions never conflict.",
  'amber means two txs in one block touched the same lane or came from the same wallet, so one had to wait for the other.',
  'a crowd is 3+ wallets painting one region in the same block. crowds push DF1 glitches up.',
] as const

const GRID_WIDTH = 1100
const ROW_HEIGHT = 20
const COLUMN_WIDTH = 11
const GRID_HEIGHT = LANE_COUNT * ROW_HEIGHT
const ZERO = '0x0000000000000000000000000000000000000000'

type Addresses = Parameters<typeof decodeLaneLogs>[1]

type FinalityMap = Map<string, LaneTx['finality']>

function applyFinality(rows: readonly LaneTx[], finality: FinalityMap) {
  return rows.map((row) => ({
    ...row,
    kinds: new Set(row.kinds),
    finality: finality.get(row.txHash.toLowerCase()) ?? row.finality,
  }))
}

function currentDayKey() {
  return new Date().toISOString().slice(0, 10)
}

function readCrowdsToday() {
  try {
    const parsed = JSON.parse(localStorage.getItem(`r3os.lanes.crowds.${currentDayKey()}`) || '[]') as unknown
    return new Set(
      Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [],
    )
  } catch {
    return new Set<string>()
  }
}

function rememberCrowds(blocks: readonly LaneBlock[]) {
  const seen = readCrowdsToday()
  for (const block of blocks) for (const chord of block.chords) seen.add(`${block.blockNumber}:${chord.lane}`)
  try {
    localStorage.setItem(`r3os.lanes.crowds.${currentDayKey()}`, JSON.stringify([...seen]))
  } catch {
    // Session-only stats are still useful when storage is blocked.
  }
  return seen.size
}

function txFill(kind: 'canvas' | 'flipbook' | 'mint' | 'lab') {
  if (kind === 'flipbook') return '#ee93e3'
  if (kind === 'mint') return '#f7931a'
  if (kind === 'lab') return '#9f70da'
  return '#5feddf'
}

function finalityOpacity(value: LaneTx['finality']) {
  if (value === 'proposed') return 0.08
  if (value === 'voted') return 0.45
  return 0.82
}

export function LanesProgram() {
  const clock = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const [addresses, setAddresses] = useState<Addresses>()
  const [txs, setTxs] = useState<LaneTx[]>([])
  const [selectedBlock, setSelectedBlock] = useState<bigint>()
  const [crowdsToday, setCrowdsToday] = useState(() => readCrowdsToday().size)
  const [message, setMessage] = useState('')
  const lastPolled = useRef<bigint | undefined>(undefined)
  const initialLoaded = useRef(false)
  const finality = useRef<FinalityMap>(new Map())

  useEffect(() => {
    let cancelled = false
    void discoverContracts()
      .then((contracts) => {
        const flipbook = contracts.labs.flipbook
        if (!contracts.paint || !flipbook) throw new Error('Lanes needs Paint and Flipbook deployed')
        if (cancelled) return
        setAddresses({
          paint: contracts.paint,
          flipbook,
          weeds: contracts.labs.weeds,
          forks: contracts.labs.forks,
          brushes: contracts.labs.brushes,
          auction: contracts.labs['finale auction'],
          quests: contracts.labs.quests,
        })
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : String(error)))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!publicClient || !addresses || clock.block <= 0n || initialLoaded.current) return
    initialLoaded.current = true
    let cancelled = false
    const list = Object.values(addresses).filter(Boolean) as Address[]
    const fromBlock = clock.block >= 99n ? clock.block - 99n : 0n
    void publicClient
      .getLogs({ address: list, fromBlock, toBlock: clock.block } as any)
      .then((logs) => {
        if (cancelled) return
        const decoded = applyFinality(decodeLaneLogs(logs as Log[], addresses), finality.current)
        setTxs(decoded)
        lastPolled.current = clock.block
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : String(error)))
    return () => {
      cancelled = true
    }
  }, [addresses, clock.block])

  useEffect(() => {
    if (!addresses || !wsClient) return
    const list = Object.values(addresses).filter(Boolean) as Address[]
    let disposed = false
    let stopMonad: (() => void) | undefined
    const stopLogs = (wsClient as any).watchEvent({
      address: list,
      onLogs: (logs: Log[]) => {
        const decoded = applyFinality(decodeLaneLogs(logs, addresses), finality.current)
        const keepFrom = getBlockSnapshot().block >= 99n ? getBlockSnapshot().block - 99n : 0n
        setTxs((current) => mergeLaneTxs(current, decoded, keepFrom))
      },
    }) as () => void
    void subscribeMonadLogs(list, (notification: MonadLogNotification) => {
      if (!notification.transactionHash) return
      const state: LaneTx['finality'] =
        notification.commitState === 'Verified'
          ? 'finalized'
          : (notification.commitState.toLowerCase() as LaneTx['finality'])
      finality.current.set(notification.transactionHash.toLowerCase(), state)
      setTxs((current) =>
        current.map((tx) =>
          tx.txHash.toLowerCase() === notification.transactionHash!.toLowerCase()
            ? { ...tx, kinds: new Set(tx.kinds), finality: state }
            : tx,
        ),
      )
    })
      .then((stop) => {
        if (disposed) stop()
        else stopMonad = stop
      })
      .catch(() => undefined)

    return () => {
      disposed = true
      stopLogs?.()
      stopMonad?.()
    }
  }, [addresses])

  useEffect(() => {
    if (!publicClient || wsClient || !addresses || clock.block <= 0n) return
    const previous = lastPolled.current
    if (previous == null) {
      lastPolled.current = clock.block
      return
    }
    if (clock.block <= previous || clock.block - previous < 10n) return
    const fromBlock = previous + 1n
    const toBlock = clock.block
    lastPolled.current = toBlock
    const list = Object.values(addresses).filter(Boolean) as Address[]
    void publicClient
      .getLogs({ address: list, fromBlock, toBlock } as any)
      .then((logs) => {
        const decoded = decodeLaneLogs(logs as Log[], addresses)
        const keepFrom = clock.block >= 99n ? clock.block - 99n : 0n
        setTxs((current) => mergeLaneTxs(current, decoded, keepFrom))
      })
      .catch(() => undefined)
  }, [clock.block, addresses])

  const mapped = useMemo(() => mapLaneWindow(txs, clock.block, 100), [txs, clock.block])
  const summary = useMemo(() => summarize(mapped.blocks), [mapped.blocks])
  const recentBlocks = Math.max(1, Math.ceil(10_000 / Math.max(1, clock.blockTimeMs)))
  const lastTen = mapped.blocks.slice(-recentBlocks)
  const recentSummary = summarize(lastTen)
  const selected = mapped.blocks.find((block) => block.blockNumber === selectedBlock)
  const details = selected ? blockDetails(selected) : []

  useEffect(() => {
    setCrowdsToday(rememberCrowds(mapped.blocks))
  }, [mapped.blocks])

  const entryByHash = useMemo(() => {
    const map = new Map<string, LaneTx>()
    for (const block of mapped.blocks)
      for (const entry of block.entries) map.set(entry.txHash.toLowerCase(), entry)
    return map
  }, [mapped.blocks])

  const connections = useMemo(() => {
    const lines: { key: string; block: bigint; fromLane: number; toLane: number }[] = []
    const seen = new Set<string>()
    for (const block of mapped.blocks) {
      for (const entry of block.entries) {
        const fromLane = lanesFor(entry)[0]
        if (fromLane == null) continue
        for (const hash of entry.conflictsWith) {
          const key = [entry.txHash.toLowerCase(), hash.toLowerCase()].sort().join(':')
          if (seen.has(key)) continue
          seen.add(key)
          const other = entryByHash.get(hash.toLowerCase())
          const toLane = other ? lanesFor(other)[0] : undefined
          if (toLane != null) lines.push({ key, block: block.blockNumber, fromLane, toLane })
        }
      }
    }
    return lines
  }, [mapped.blocks, entryByHash])

  return (
    <div className="lab-program phase4a-program lanes-program">
      <MenuBar
        menus={[
          { label: 'File', items: [{ label: 'Close', action: () => closeWindow('lanes') }] },
          {
            label: 'View',
            items: [{ label: 'Latest 100 blocks', action: () => setSelectedBlock(undefined) }],
          },
          {
            label: 'Lanes',
            items: [{ label: 'Clear block detail', action: () => setSelectedBlock(undefined) }],
          },
          { label: 'Help', items: [{ label: 'About parallel execution', action: () => undefined }] },
        ]}
      />
      <IntroBar
        lead="every tx this app sends, drawn in the lane of the state it touches. txs in separate lanes don't touch each other, so they can execute in parallel."
        monad="txs run optimistically in parallel and only the ones that actually conflict get re-run. this is our estimate of that for this app."
        rules={RULES}
        finalLine="estimated from the contracts' storage layout. monad's executor decides the real schedule."
      />

      <div className="lanes-counters">
        <div className="sunken">
          <small>app txs, last 10 s</small>
          <b>{recentSummary.txs}</b>
        </div>
        <div className="sunken">
          <small>ran in parallel (est.)</small>
          <b>{Math.round(recentSummary.independentShare * 100)}%</b>
        </div>
        <div className="sunken">
          <small>blocks per second</small>
          <b>{clock.blockTimeMs ? (1000 / clock.blockTimeMs).toFixed(2) : '—'}</b>
        </div>
        <div className="sunken" title="crowds observed by this app today">
          <small>crowds today</small>
          <b>{crowdsToday}</b>
        </div>
      </div>

      <div className="lanes-legend">
        <span>
          <i style={{ background: '#5feddf' }} />
          no conflict
        </span>
        <span>
          <i className="conflict" />
          conflict (line joins the pair)
        </span>
        <span>
          <i style={{ background: '#fec343' }} />
          crowd: 3+ wallets, one region, one block
        </span>
        <span>
          <i style={{ background: '#ee93e3' }} />
          flipbook
        </span>
        <span>
          <i style={{ background: '#f7931a' }} />
          mints
        </span>
        <span>
          <i style={{ background: '#9f70da' }} />
          lab
        </span>
      </div>

      <div className="lanes-grid-wrap sunken">
        <div className="lane-labels">
          {LANE_LABELS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <svg
          viewBox={`0 0 ${GRID_WIDTH} ${GRID_HEIGHT}`}
          className="lanes-grid"
          aria-label="19 lanes across the last 100 blocks"
        >
          {Array.from({ length: LANE_COUNT + 1 }, (_, row) => (
            <line
              key={`row-${row}`}
              x1="0"
              x2={GRID_WIDTH}
              y1={row * ROW_HEIGHT}
              y2={row * ROW_HEIGHT}
              stroke="#1f1f23"
            />
          ))}
          {mapped.blocks.map(
            (block, index) =>
              block.storm && (
                <rect
                  key={`storm-${block.blockNumber}`}
                  x={index * COLUMN_WIDTH}
                  y="0"
                  width={COLUMN_WIDTH}
                  height={GRID_HEIGHT}
                  fill="#c52020"
                  opacity="0.13"
                />
              ),
          )}
          {connections.map((line) => {
            const x = Number(line.block - mapped.from) * COLUMN_WIDTH + COLUMN_WIDTH / 2
            return (
              <line
                key={line.key}
                x1={x}
                x2={x}
                y1={line.fromLane * ROW_HEIGHT + 10}
                y2={line.toLane * ROW_HEIGHT + 10}
                stroke="#fec343"
                strokeWidth="1"
                opacity="0.7"
              />
            )
          })}
          {mapped.marks.map((mark, index) => {
            const x = Number(mark.blockNumber - mapped.from) * COLUMN_WIDTH + 1
            const y = mark.lane * ROW_HEIGHT + 4
            const fill = mark.crowd ? '#fec343' : txFill(mark.kind)
            return (
              <rect
                key={`${mark.txHash}-${mark.lane}-${index}`}
                x={x}
                y={y}
                width="9"
                height="12"
                fill={fill}
                fillOpacity={finalityOpacity(mark.finality)}
                stroke={mark.conflict ? '#fec343' : 'none'}
                strokeWidth={mark.conflict ? 1.5 : 0}
              />
            )
          })}
          {mapped.blocks.flatMap((block, index) =>
            block.chords.map((chord) => {
              const x = index * COLUMN_WIDTH + 5.5
              const y = chord.lane * ROW_HEIGHT + 10
              return (
                <path
                  key={`crowd-${block.blockNumber}-${chord.lane}`}
                  d={`M${x} ${y - 8} l2 5 5 -1 -3 4 3 4 -5 -1 -2 5 -2 -5 -5 1 3 -4 -3 -4 5 1z`}
                  fill="#fec343"
                  opacity="0.9"
                />
              )
            }),
          )}
          {mapped.blocks.map((block, index) => (
            <rect
              key={`hit-${block.blockNumber}`}
              x={index * COLUMN_WIDTH}
              y="0"
              width={COLUMN_WIDTH}
              height={GRID_HEIGHT}
              fill="transparent"
              onClick={() => setSelectedBlock(block.blockNumber)}
              style={{ cursor: 'pointer' }}
            />
          ))}
        </svg>
      </div>

      {selected && (
        <fieldset className="lanes-detail group-box">
          <legend>
            Block #{selected.blockNumber.toString()} · {selected.storm ? 'STORM · ' : ''}
            {selected.entries.length} app txs
          </legend>
          <div className="lanes-detail-head">
            <span>tx</span>
            <span>wallet</span>
            <span>action</span>
            <span>lanes</span>
            <span>pixels</span>
            <span>DF1</span>
            <span>conflicts</span>
          </div>
          {details.length ? (
            details.map((row) => (
              <div key={row.txHash} className="lanes-detail-row">
                <code>{row.txHash.slice(0, 8)}…</code>
                <span>{row.wallet === ZERO ? 'unknown' : shortAddress(row.wallet as Address)}</span>
                <span>{row.action}</span>
                <span>{row.lanes}</span>
                <span>{row.pixels}</span>
                <span>{row.glitches}</span>
                <span>{row.conflicts}</span>
              </div>
            ))
          ) : (
            <small>no app transactions in this block</small>
          )}
        </fieldset>
      )}

      {message && <div className="phase4a-message">{message}</div>}
      <div className="phase4a-status">
        <span>estimated from the contracts' storage layout. monad's executor decides the real schedule.</span>
        <span>{summary.txs} txs / 100 blocks</span>
        <span>#{clock.block.toString()}</span>
      </div>
    </div>
  )
}
