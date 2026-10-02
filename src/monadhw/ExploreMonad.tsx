import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Address } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { chainName, config } from '../chain/config'
import { MONAD_HW_SPEC } from '../chain/monadHardware'
import { readHeavy } from '../chain/readMany'
import { R3TARDS_PAGE_EXE_ABI } from '../lib/generated/abi'
import { labAddress, labLoadError, LabNotDeployedError, shortAddress } from '../labs/labCommon'
import { openProgram } from '../os/programs'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import {
  DEFAULT_GAS_PER_FRAME,
  DEFAULT_PROBE_STATIC,
  MAX_VENUES,
  loadRouterEnvironment,
  runCompare,
  tokenMetadata,
} from '../router/routerLab'
import { MAINNET_TOKENS, formatAmount, venuesForPair, type RouterVenue } from '../router/venues'
import {
  STORAGE_RACE_READS,
  formatBlockMs,
  liquidityRows,
  netGas,
  observedBlockMs,
  pushBlockSample,
  sampleGap,
  storageRace,
  type BlockSample,
  type LiquidityRow,
  type StorageRaceResult,
} from './explore'

function Details({ children }: { children: ReactNode }) {
  return (
    <details className="explore-details">
      <summary>Technical details</summary>
      <div className="explore-details-body">{children}</div>
    </details>
  )
}

function Tag({ kind }: { kind: 'measured' | 'spec' | 'onchain' }) {
  return <span className={`hw-source source-${kind}`}>{kind}</span>
}

// ---------------------------------------------------------------------------

function BlockSpeed() {
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const [watching, setWatching] = useState(true)
  const [samples, setSamples] = useState<BlockSample[]>([])

  // Reads the app's one shared block stream: no extra RPC. Pausing just stops recording.
  useEffect(() => {
    if (!watching || block.block === 0n) return
    const at = typeof performance === 'undefined' ? Date.now() : performance.now()
    setSamples((current) => pushBlockSample(current, { block: block.block, at }))
  }, [block.block, watching])

  const offline = block.mode === 'offline' || block.block === 0n
  // The oldest sample is when this panel opened, not a block arrival: measure from the arrivals after it.
  const observed = samples.length >= 3 ? observedBlockMs(samples.slice(0, -1)) : undefined
  return (
    <GroupBox title="Block speed">
      <p className="explore-lead">Watch Monad make new blocks.</p>
      <div className="block-ticker sunken" aria-live="off">
        {offline ? (
          <span className="muted">not connected to Monad right now</span>
        ) : samples.length ? (
          samples.map((sample, index) => (
            <div key={sample.block.toString()} className={index === 0 ? 'newest' : undefined}>
              <span>BLOCK {sample.block.toString()}</span>
              <span>{sampleGap(samples, index)}</span>
            </div>
          ))
        ) : (
          <span className="muted">waiting for the next block…</span>
        )}
      </div>
      <div className="explore-result-line">
        <b className="explore-big">{offline ? '—' : formatBlockMs(observed)}</b>
        <span>per block, seen by this browser</span>
      </div>
      <div className="explore-actions">
        <Button
          onClick={() => {
            // Resuming starts a fresh measurement: the paused gap is not block time.
            if (!watching) setSamples([])
            setWatching((value) => !value)
          }}
          disabled={offline}
        >
          {watching ? 'Pause' : 'Watch'}
        </Button>
        <Button onClick={() => openProgram('validators')}>Who makes them?</Button>
      </div>
      <Details>
        <dl className="explore-dl">
          <dt>network</dt>
          <dd>
            {chainName} · chain {config.chainId}
          </dd>
          <dt>seen here</dt>
          <dd>
            {formatBlockMs(observed)} over the last {Math.max(0, samples.length - 2)} gaps{' '}
            <Tag kind="measured" />
          </dd>
          <dt>app average</dt>
          <dd>
            {offline ? '—' : formatBlockMs(block.blockTimeMs)} <Tag kind="measured" />
          </dd>
          <dt>Monad target</dt>
          <dd>
            ~{MONAD_HW_SPEC.blockTimeMs.value} ms <Tag kind="spec" />
          </dd>
          <dt>connection</dt>
          <dd>
            {block.mode === 'live' ? 'live (websocket)' : block.mode === 'polling' ? 'polling' : 'offline'}
          </dd>
        </dl>
        <p>
          this is how fast new blocks reach this browser through its RPC, not how long finality takes. polling
          and network delay make it a little uneven.
        </p>
      </Details>
    </GroupBox>
  )
}

// ---------------------------------------------------------------------------

type RaceState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: StorageRaceResult; cold?: bigint; warm?: bigint; block: bigint; address: Address }
  | { kind: 'unavailable'; text: string }

function StorageRace() {
  const [state, setState] = useState<RaceState>({ kind: 'idle' })

  async function run() {
    setState({ kind: 'running' })
    try {
      const address = await labAddress('page-exe')
      const head = getBlockSnapshot().block
      // Three eth_calls, only when pressed: 128 reads on one page, 128 reads on 128 pages, and the page probe.
      const rows = await readHeavy(
        [
          {
            address,
            abi: R3TARDS_PAGE_EXE_ABI,
            functionName: 'benchRead',
            args: [0, BigInt(STORAGE_RACE_READS)],
          },
          {
            address,
            abi: R3TARDS_PAGE_EXE_ABI,
            functionName: 'benchRead',
            args: [1, BigInt(STORAGE_RACE_READS)],
          },
          { address, abi: R3TARDS_PAGE_EXE_ABI, functionName: 'probePage' },
        ],
        { concurrency: 2 },
      )
      if (rows[0]?.status !== 'success' || rows[1]?.status !== 'success')
        throw new Error('measurement failed')
      const [contiguous, overheadA] = rows[0].result as readonly bigint[]
      const [scattered, overheadB] = rows[1].result as readonly bigint[]
      const result = storageRace(netGas(contiguous, overheadA), netGas(scattered, overheadB))
      if (!result) throw new Error('measurement failed')
      let cold: bigint | undefined
      let warm: bigint | undefined
      if (rows[2]?.status === 'success') {
        const [c, w, , overhead] = rows[2].result as readonly bigint[]
        cold = netGas(c, overhead)
        warm = netGas(w, overhead)
      }
      setState({ kind: 'done', result, cold, warm, block: head, address })
    } catch (error) {
      setState({
        kind: 'unavailable',
        text:
          error instanceof LabNotDeployedError
            ? 'not available: the storage test contract isn’t installed on this network.'
            : error instanceof Error && error.message === 'measurement failed'
              ? 'the measurement failed. try again.'
              : labLoadError(error),
      })
    }
  }

  const done = state.kind === 'done' ? state : undefined
  return (
    <GroupBox title="Storage race">
      <p className="explore-lead">Read the same amount of data two different ways.</p>
      <div className="explore-actions">
        <Button primary disabled={state.kind === 'running'} onClick={() => void run()}>
          {state.kind === 'running' ? 'Running…' : done ? 'Run again' : 'Run test'}
        </Button>
        <span className="muted">free · nothing is sent</span>
      </div>
      {done && (
        <>
          <div className="race-bars">
            <div className="race-row">
              <span>ONE PAGE</span>
              <div className="race-track sunken">
                <i style={{ width: `${done.result.onePagePct}%` }} />
              </div>
              <code>{done.result.onePage.toLocaleString()} gas</code>
            </div>
            <div className="race-row">
              <span>SCATTERED</span>
              <div className="race-track sunken">
                <i className="slow" style={{ width: `${done.result.scatteredPct}%` }} />
              </div>
              <code>{done.result.scattered.toLocaleString()} gas</code>
            </div>
          </div>
          <div className="explore-result-line">
            <b className="explore-big">{done.result.ratioText}</b>
            <span>more gas when the data is scattered</span>
          </div>
          <p className="explore-why">
            {done.result.pageEffect
              ? 'Monad stores data in 4 KiB pages. The first read warms the whole page, so its neighbours are cheap.'
              : 'this network didn’t show a page discount this time, so the two ways cost about the same.'}
          </p>
        </>
      )}
      {state.kind === 'unavailable' && <p className="explore-why">{state.text}</p>}
      <Details>
        <dl className="explore-dl">
          <dt>rule</dt>
          <dd>MIP-8 storage pages: 128 slots = 4 KiB per page</dd>
          <dt>test</dt>
          <dd>
            {STORAGE_RACE_READS} reads of neighbouring slots vs {STORAGE_RACE_READS} reads, one per page
          </dd>
          {done && (
            <>
              <dt>first read</dt>
              <dd>
                {done.cold == null ? 'unknown' : `${done.cold.toLocaleString()} gas (cold)`}{' '}
                <Tag kind="measured" />
              </dd>
              <dt>its neighbour</dt>
              <dd>
                {done.warm == null ? 'unknown' : `${done.warm.toLocaleString()} gas (warm)`}{' '}
                <Tag kind="measured" />
              </dd>
              <dt>measured at</dt>
              <dd>
                block {done.block.toString()} · contract {shortAddress(done.address)}
              </dd>
            </>
          )}
          <dt>how</dt>
          <dd>
            eth_call to PAGE.EXE’s benchRead: the gas is measured inside the EVM; nothing is written or paid
          </dd>
        </dl>
      </Details>
    </GroupBox>
  )
}

// ---------------------------------------------------------------------------

function BlockCameraCard() {
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  return (
    <GroupBox title="Block camera">
      <p className="explore-lead">Turn the current block into a picture you can mint.</p>
      <div className="camera-card sunken">
        <span className="camera-card-lens" aria-hidden="true" />
        <div>
          <b>{block.block ? `BLOCK ${block.block.toString()}` : 'no block yet'}</b>
          <small>
            {block.block ? `made by ${shortAddress(block.miner)}` : 'connect to Monad to see the live block'}
          </small>
        </div>
      </div>
      <p className="explore-why">
        the picture is built onchain from the block your capture lands in: who made it, its epoch and its
        parent hash.
      </p>
      <div className="explore-actions">
        <Button primary onClick={() => openProgram('block-camera')}>
          Open Block Camera
        </Button>
      </div>
    </GroupBox>
  )
}

// ---------------------------------------------------------------------------

type LiquidityState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'mainnet-only' }
  | { kind: 'unavailable'; text: string }
  | { kind: 'ready'; lab: Address; venues: RouterVenue[]; tokenIn: Address; tokenOut: Address; test: boolean }

type LiquidityResult = {
  rows: LiquidityRow[]
  symbolIn: string
  symbolOut: string
  decimalsOut: number
  block: bigint
  pinned: boolean
  asked: number
}

/** Real markets live on mainnet. Elsewhere this only runs against the test venues in a dev build. */
function useLiquidityEnvironment(): LiquidityState {
  const [state, setState] = useState<LiquidityState>({ kind: 'loading' })
  useEffect(() => {
    let cancelled = false
    // Off mainnet there are no real markets: don't even read the test directory (no RPC) outside a dev build.
    if (config.chainId !== 143 && !import.meta.env.DEV) {
      setState({ kind: 'mainnet-only' })
      return
    }
    void loadRouterEnvironment()
      .then((env) => {
        if (cancelled) return
        const mainnet = config.chainId === 143
        if (!mainnet && !(import.meta.env.DEV && env.mock && env.venues.length)) {
          setState({ kind: 'mainnet-only' })
          return
        }
        if (!env.lab) {
          setState({
            kind: 'unavailable',
            text: 'not available: the comparison contract isn’t installed here.',
          })
          return
        }
        const tokenIn = mainnet ? MAINNET_TOKENS.WMON : env.venues[0].token0
        const tokenOut = mainnet ? MAINNET_TOKENS.USDC : env.venues[0].token1
        const venues = venuesForPair(tokenIn, tokenOut, env.venues).slice(0, MAX_VENUES)
        if (!venues.length) {
          setState({ kind: 'unavailable', text: 'no markets are configured for this network.' })
          return
        }
        setState({ kind: 'ready', lab: env.lab, venues, tokenIn, tokenOut, test: !mainnet })
      })
      .catch(() => !cancelled && setState({ kind: 'unavailable', text: labLoadError(undefined) }))
    return () => {
      cancelled = true
    }
  }, [])
  return state
}

function LiquidityRace() {
  const env = useLiquidityEnvironment()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<LiquidityResult>()
  const [error, setError] = useState('')

  async function compare() {
    if (env.kind !== 'ready') return
    setBusy(true)
    setError('')
    try {
      const [inMeta, outMeta] = await Promise.all([tokenMetadata(env.tokenIn), tokenMetadata(env.tokenOut)])
      const amountIn = 10n ** BigInt(inMeta.decimals)
      // One eth_call: the lab asks every market inside its own frame and rolls each one back.
      const comparison = await runCompare({
        lab: env.lab,
        tokenIn: env.tokenIn,
        tokenOut: env.tokenOut,
        amountIn,
        venues: env.venues,
        gasPerFrame: DEFAULT_GAS_PER_FRAME,
        probeStatic: DEFAULT_PROBE_STATIC,
      })
      setResult({
        rows: liquidityRows(
          comparison.reports,
          env.venues.map((venue) => venue.label),
          comparison.winner,
        ),
        symbolIn: inMeta.symbol,
        symbolOut: outMeta.symbol,
        decimalsOut: outMeta.decimals,
        block: comparison.blockNumber,
        pinned: comparison.blockPinned,
        asked: env.venues.length,
      })
    } catch {
      setError('the comparison failed. the RPC may be busy; try again.')
    } finally {
      setBusy(false)
    }
  }

  const highest = result?.rows.find((row) => row.highest && row.amountOut != null)
  return (
    <GroupBox title="Liquidity race">
      <p className="explore-lead">Ask several Monad markets for the same quote.</p>
      {env.kind === 'mainnet-only' ? (
        <p className="explore-why">
          <b>MAINNET DEMO.</b> Monad’s real markets are on mainnet; this network has none to ask.
        </p>
      ) : env.kind === 'unavailable' ? (
        <p className="explore-why">{env.text}</p>
      ) : (
        <div className="explore-actions">
          <Button primary disabled={env.kind !== 'ready' || busy} onClick={() => void compare()}>
            {busy ? 'Asking…' : result ? 'Compare again' : 'Compare'}
          </Button>
          <span className="muted">
            {env.kind === 'ready'
              ? `1 ${result?.symbolIn ?? (env.test ? 'token' : 'WMON')} → ${result?.symbolOut ?? (env.test ? 'token' : 'USDC')} · nothing is traded`
              : 'loading markets…'}
          </span>
        </div>
      )}
      {env.kind === 'ready' && env.test && (
        <p className="explore-why">TEST MARKETS: development contracts, not real liquidity.</p>
      )}
      {result && (
        <>
          <div className="race-bars">
            {result.rows.map((row) => (
              <div key={row.name} className={`race-row ${row.highest ? 'highest' : ''}`}>
                <span>{row.name}</span>
                <div className="race-track sunken">
                  {row.amountOut != null && <i style={{ width: `${row.pct}%` }} />}
                </div>
                <code>
                  {row.amountOut != null
                    ? `${formatAmount(row.amountOut, result.decimalsOut, 4)} ${result.symbolOut}${row.behind ? ` · ${row.behind}` : ''}`
                    : row.note}
                </code>
              </div>
            ))}
          </div>
          <div className="explore-result-line">
            <b className="explore-big">{highest ? highest.name : '—'}</b>
            <span>{highest ? 'highest quoted output' : 'no market quoted'}</span>
          </div>
          <p className="explore-why">
            {result.asked} markets compared in one simulation · nothing was traded
          </p>
        </>
      )}
      {error && <p className="explore-why">{error}</p>}
      <Details>
        <dl className="explore-dl">
          <dt>interface</dt>
          <dd>MRC-17 DRAFT quote adapters (third-party, unaudited integration code)</dd>
          <dt>how</dt>
          <dd>
            one eth_call to ROUTER-LAB: each market is asked inside its own frame, which is always rolled
            back. same block, same state for everyone.
          </dd>
          <dt>never</dt>
          <dd>no approval, no swap, no custody, no transaction</dd>
          <dt>pick</dt>
          <dd>highest quoted output only, not a promise you would get that price later</dd>
          {result && (
            <>
              <dt>block</dt>
              <dd>
                {result.block.toString()}
                {result.pinned ? '' : ' (latest; this RPC could not pin a block)'}
              </dd>
            </>
          )}
        </dl>
      </Details>
    </GroupBox>
  )
}

// ---------------------------------------------------------------------------

export function ExploreMonad({ onSystemInfo }: { onSystemInfo: () => void }) {
  return (
    <div className="explore-monad">
      <p className="explore-intro">
        See what makes this machine different. Every number here comes from the chain or is measured live.
      </p>
      <div className="explore-grid">
        <BlockSpeed />
        <StorageRace />
        <BlockCameraCard />
        <LiquidityRace />
      </div>
      <div className="explore-footer">
        <Button onClick={onSystemInfo}>System Information…</Button>
      </div>
    </div>
  )
}
