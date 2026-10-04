import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { formatEther, type Address } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { config } from '../chain/config'
import { discoverContracts } from '../chain/contracts'
import {
  getMonadTraceFeedSnapshot,
  restartMonadTraceFeed,
  startMonadTraceFeed,
  subscribeMonadTraceFeed,
} from '../chain/monadLogs'
import { getTxTraceSnapshot, subscribeTxTrace, type TxTrace } from '../chain/txTrace'
import { getActivityFeedSnapshot, subscribeActivityFeed, type CanvasActivity } from '../paint/canvasStore'
import { Button } from '../os/ui/Button'
import { IntroBar } from '../os/ui/IntroBar'
import { overlapSummary, regionsFromMask, regionsFromRuns } from './regions'

const STAGES = ['signed', 'sent', 'proposed', 'voted', 'finalized'] as const
const STAGE_X = [32, 121, 210, 299, 388] as const

function elapsed(trace: TxTrace, value?: number) {
  const first = trace.t.signed ?? trace.t.sent
  return value == null ? undefined : Math.max(0, value - first)
}

function TxTimeline({ trace }: { trace: TxTrace }) {
  return (
    <svg className="xray-timeline" viewBox="0 0 420 100" aria-label="transaction timeline">
      <line x1="32" y1="46" x2="388" y2="46" />
      {STAGES.map((name, index) => {
        const value = trace.t[name]
        const ms = elapsed(trace, value)
        return (
          <g key={name} transform={`translate(${STAGE_X[index]},0)`}>
            <text y="18" textAnchor="middle">
              {name}
            </text>
            <circle cx="0" cy="46" r="5" className={value == null ? 'empty' : ''} />
            {ms == null ? (
              <text className="muted" textAnchor="middle">
                <tspan x="0" y="74">
                  n/a on
                </tspan>
                <tspan x="0" y="86">
                  this RPC
                </tspan>
              </text>
            ) : (
              <text y="78" textAnchor="middle">
                {Math.round(ms)} ms
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function transactionsPerBlock(items: readonly CanvasActivity[], head: bigint) {
  return Array.from({ length: 48 }, (_, index) => {
    const block = head - BigInt(47 - index)
    if (block < 0n) return 0
    const hashes = new Set(
      items
        .filter((item) => item.blockNumber === block && item.transactionHash)
        .map((item) => item.transactionHash),
    )
    return hashes.size
  })
}

export function XRayProgram() {
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const traces = useSyncExternalStore(subscribeTxTrace, getTxTraceSnapshot)
  const activity = useSyncExternalStore(subscribeActivityFeed, getActivityFeedSnapshot)
  const commitFeed = useSyncExternalStore(
    subscribeMonadTraceFeed,
    getMonadTraceFeedSnapshot,
  )
  const trace = traces.traces[0]

  useEffect(() => {
    if (commitFeed.mode !== 'idle') return
    void discoverContracts()
      .then((contracts) => {
        const addresses = [contracts.paint, contracts.pass, ...Object.values(contracts.labs)].filter(
          (address): address is Address => Boolean(address),
        )
        return startMonadTraceFeed(addresses)
      })
      .catch(() => undefined)
  }, [commitFeed.mode])

  const bars = useMemo(() => transactionsPerBlock(activity.items, block.block), [activity, block.block])
  const maxBar = Math.max(1, ...bars)
  const regions = trace?.regions ?? []
  const sameBlockPaints = useMemo(() => {
    if (!trace?.blockNumber) return []
    return activity.items.filter(
      (item) =>
        item.eventName === 'Painted' &&
        item.blockNumber === trace.blockNumber &&
        item.transactionHash !== trace.hash,
    )
  }, [activity, trace])
  const otherRegions = sameBlockPaints.map((item) =>
    item.runs ? regionsFromRuns(item.runs) : regionsFromMask(item.regionsMask ?? 0),
  )
  const overlaps = overlapSummary(regions, otherRegions)
  const pages = regions.length * 2 + (regions.length ? 1 : 0)
  const charged = trace?.effectiveGasPrice ? trace.gasLimit * trace.effectiveGasPrice : undefined

  return (
    <div className="xray-program">
      <IntroBar
        lead="your last tx, from click through receipt and Monad commit states, live."
        monad="watch the block path, fee cap and region overlap as this app sees them."
        rules={[
          'signed → sent: your wallet signs and the app hands the tx to the RPC.',
          'proposed → voted → finalized: shown only when the RPC exposes Monad commit-state notifications.',
          'gas: Monad charges the gas limit, not gas used, so every action gets a tight limit.',
          'regions: the canvas has 16 region-local storage areas that can execute in parallel.',
        ]}
      />
      <section className="xray-head sunken">
        <div className="xray-block-title">
          <i /> <b>#{block.block.toString()}</b>
          <span>
            {(block.blockTimeMs / 1000).toFixed(2)} s / block · {(1000 / block.blockTimeMs).toFixed(1)}{' '}
            blocks/s
          </span>
        </div>
        <div className="xray-bars" aria-label="this app's transactions per block">
          {bars.map((value, index) => (
            <i
              key={index}
              className={index === bars.length - 1 ? 'newest' : ''}
              style={{ height: `${Math.max(2, (value / maxBar) * 42)}px` }}
              title={`${value} transaction${value === 1 ? '' : 's'}`}
            />
          ))}
        </div>
        <small>this app's transactions per block, last 48 blocks</small>
      </section>

      <section className="xray-section">
        <h3>Your last transaction · {trace?.action ?? 'none yet'}</h3>
        {trace ? (
          <>
            <TxTimeline trace={trace} />
            <div className="xray-proof-row">
              <code title={trace.hash}>{`${trace.hash.slice(0, 10)}…${trace.hash.slice(-8)}`}</code>
              <span>{trace.blockNumber == null ? 'waiting for block' : `block #${trace.blockNumber.toString()}`}</span>
              <span>
                {trace.t.receipt == null
                  ? 'receipt pending'
                  : `receipt ${Math.round(elapsed(trace, trace.t.receipt) ?? 0)} ms`}
              </span>
              <span>{trace.signer === 'burner' ? 'browser session key' : 'wallet'}</span>
              {config.explorerUrl && (
                <a href={`${config.explorerUrl}/tx/${trace.hash}`} target="_blank" rel="noreferrer">
                  Open in explorer
                </a>
              )}
            </div>
          </>
        ) : (
          <p>send something and it shows up here.</p>
        )}
        <small>
          commit-state feed: {commitFeed.mode === 'live' ? 'monadLogs live' : commitFeed.mode === 'connecting' ? 'connecting…' : 'unavailable on this RPC'} · receipt inclusion is tracked separately
          {commitFeed.mode === 'unavailable' && (
            <>
              {' · '}
              <Button
                onClick={() => {
                  void discoverContracts()
                    .then((contracts) => {
                      const addresses = [contracts.paint, contracts.pass, ...Object.values(contracts.labs)].filter(
                        (address): address is Address => Boolean(address),
                      )
                      return restartMonadTraceFeed(addresses)
                    })
                    .catch(() => undefined)
                }}
              >
                Retry feed
              </Button>
            </>
          )}
        </small>
      </section>

      <section className="xray-section">
        <h3>Gas</h3>
        <div className="xray-gas-grid">
          <span>limit</span>
          <i className="gas-limit" />
          <b>{trace?.gasLimit.toString() ?? '—'}</b>
          <span>used</span>
          <i
            className="gas-used"
            style={{
              width: trace?.gasUsed
                ? `${Math.min(100, Number((trace.gasUsed * 100n) / trace.gasLimit))}%`
                : '0%',
            }}
          />
          <b>{trace?.gasUsed?.toString() ?? '—'}</b>
        </div>
        <p>
          charged:{' '}
          {charged != null && trace?.effectiveGasPrice != null
            ? `${Number(formatEther(charged)).toFixed(6)} MON at ${Number(
                trace.effectiveGasPrice / 1_000_000_000n,
              )} gwei = limit × price.`
            : '—'}{' '}
          On Monad you pay for the limit you set, so the app sets tight limits.
        </p>
      </section>

      <section className="xray-section">
        <h3>Storage and regions</h3>
        <div className="region-grid">
          {Array.from({ length: 16 }, (_, region) => {
            const mine = regions.includes(region)
            const other = overlaps.otherRegions.includes(region)
            return (
              <span key={region} className={mine ? 'mine' : other ? 'other' : ''}>
                {region}
              </span>
            )
          })}
        </div>
        {regions.length ? (
          <>
            <p>
              {pages} storage pages touched: {regions.length} canvas-row page
              {regions.length === 1 ? '' : 's'}, {regions.length} state page
              {regions.length === 1 ? '' : 's'}, your painter record.
            </p>
            <p>{overlaps.text}</p>
            <small>
              {overlaps.overlappingPaints
                ? `${overlaps.overlappingPaints} of them hit your regions, so those were ordered.`
                : "different regions live in different storage pages, so these paints don't " +
                  'conflict with yours.'}
            </small>
          </>
        ) : (
          <p>the last transaction was not a canvas paint.</p>
        )}
      </section>
    </div>
  )
}
