import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { screenSafeMessage } from '../chain/errors'
import type { Address } from 'viem'
import { config } from '../chain/config'
import { useRefreshTick } from '../chain/refreshTick'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { IntroBar } from '../os/ui/IntroBar'
import { Tabs } from '../os/ui/Tabs'
import { decodeAdapterError } from './mrc17'
import { ROUTER_COPY } from './copy'
import {
  DEFAULT_GAS_PER_FRAME,
  DEFAULT_PROBE_STATIC,
  LOW_GAS_POOL_LIMIT,
  compareGas,
  loadRouterEnvironment,
  runCompare,
  runMonoperCrossCheck,
  runSimulation,
  tokenMetadata,
  traceLines,
  venueCodeInfo,
  type RouterComparison,
  type RouterEnvironment,
  type RouterSimulation,
  type TokenMeta,
  type VenueCodeInfo,
} from './routerLab'
import {
  bpsDelta,
  formatAmount,
  pairsFor,
  parseAmount,
  statusLabel,
  venuesForPair,
  type RouterVenue,
} from './venues'
import './router.css'

const GAS_OPTIONS = [1_000_000n, 2_000_000n, 3_000_000n, 5_000_000n] as const
const UINT256_MAX = (1n << 256n) - 1n

function short(value: string) {
  return `${value.slice(0, 8)}…${value.slice(-6)}`
}

function pctBps(value: bigint) {
  const sign = value > 0n ? '+' : ''
  const whole = value / 100n
  const fraction = (value < 0n ? -value : value) % 100n
  return `${sign}${whole}.${fraction.toString().padStart(2, '0')}`
}

function formatGas(value: bigint) {
  return `${(Number(value) / 1_000_000).toFixed(1)}M`
}

function staticLabel(value: number) {
  if (value === 1) return 'OK'
  if (value === 2) return 'FAILED'
  return '—'
}

function codeLabel(info?: VenueCodeInfo) {
  if (!info) return 'checking…'
  if (info.state === 'match') return 'code hash matches manifest'
  if (info.state === 'differs') return 'code differs'
  if (info.state === 'no-code') return 'no code'
  return 'not pinned'
}

function same(a?: Address, b?: Address) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase())
}

export function RouterProgram() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const refreshTick = useRefreshTick(30)
  const [env, setEnv] = useState<RouterEnvironment>()
  const [pairIndex, setPairIndex] = useState(0)
  const [reverse, setReverse] = useState(false)
  const [amount, setAmount] = useState('1')
  const [gasPerFrame, setGasPerFrame] = useState(DEFAULT_GAS_PER_FRAME)
  const [probeStatic, setProbeStatic] = useState(DEFAULT_PROBE_STATIC)
  const [auto, setAuto] = useState(false)
  const [crossCheck, setCrossCheck] = useState(false)
  const [tab, setTab] = useState('ROUTING')
  const [comparison, setComparison] = useState<RouterComparison>()
  const [simulation, setSimulation] = useState<RouterSimulation>()
  const [monoper, setMonoper] = useState<{ amountOut: bigint; adapter: Address; candidateIndex: bigint }>()
  const [selected, setSelected] = useState(0)
  const [tokenInMeta, setTokenInMeta] = useState<TokenMeta>()
  const [tokenOutMeta, setTokenOutMeta] = useState<TokenMeta>()
  const [codeInfo, setCodeInfo] = useState<Record<string, VenueCodeInfo>>({})
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    void loadRouterEnvironment()
      .then((value) => !cancelled && setEnv(value))
      .catch((error) => !cancelled && setMessage(screenSafeMessage(error)))
    return () => {
      cancelled = true
    }
  }, [])

  const pairs = useMemo(() => pairsFor(config.chainId, env?.venues ?? []), [env])
  const [symbols, setSymbols] = useState<Record<string, string>>({})
  useEffect(() => {
    const tokens = [...new Set(pairs.flatMap((item) => [item.token0, item.token1]))]
    if (!tokens.length) return
    let cancelled = false
    void Promise.all(tokens.map(async (token) => [token.toLowerCase(), (await tokenMetadata(token)).symbol]))
      .then((entries) => !cancelled && setSymbols(Object.fromEntries(entries)))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [pairs])
  const symbolOf = (token: Address) => symbols[token.toLowerCase()] ?? short(token)
  const pair = pairs[Math.min(pairIndex, Math.max(0, pairs.length - 1))]
  const tokenIn = pair ? (reverse ? pair.token1 : pair.token0) : undefined
  const tokenOut = pair ? (reverse ? pair.token0 : pair.token1) : undefined
  const venues = useMemo(
    () => (tokenIn && tokenOut ? venuesForPair(tokenIn, tokenOut, env?.venues ?? []).slice(0, 8) : []),
    [tokenIn, tokenOut, env],
  )

  useEffect(() => {
    setComparison(undefined)
    setSimulation(undefined)
    setMonoper(undefined)
    setSelected(0)
    if (!tokenIn || !tokenOut) return
    let cancelled = false
    void Promise.all([tokenMetadata(tokenIn), tokenMetadata(tokenOut)]).then(([input, output]) => {
      if (cancelled) return
      setTokenInMeta(input)
      setTokenOutMeta(output)
    })
    return () => {
      cancelled = true
    }
  }, [tokenIn, tokenOut])

  useEffect(() => {
    if (!venues.length) return
    let cancelled = false
    void Promise.all(
      venues.map(async (venue) => [venue.adapter.toLowerCase(), await venueCodeInfo(venue)] as const),
    ).then((entries) => {
      if (!cancelled) setCodeInfo((current) => ({ ...current, ...Object.fromEntries(entries) }))
    })
    return () => {
      cancelled = true
    }
  }, [venues])

  async function run(showPending = true) {
    if (!env?.lab || !tokenIn || !tokenOut || !tokenInMeta || !tokenOutMeta || !venues.length) return
    if (showPending) setPending(true)
    setMessage('')
    try {
      const amountIn = parseAmount(amount, tokenInMeta.decimals)
      const next = await runCompare({
        lab: env.lab,
        tokenIn,
        tokenOut,
        amountIn,
        venues,
        gasPerFrame,
        probeStatic,
      })
      setComparison(next)
      setSimulation(undefined)
      setSelected(next.winner === UINT256_MAX ? 0 : Number(next.winner))
      if (crossCheck && config.chainId === 143) {
        try {
          const reference = await runMonoperCrossCheck({
            tokenIn,
            tokenOut,
            amountIn,
            venues,
            blockNumber: next.blockNumber,
          })
          setMonoper(reference)
        } catch (error) {
          setMonoper(undefined)
          setMessage(`Monoper cross-check: ${screenSafeMessage(error)}`)
        }
      } else setMonoper(undefined)
    } catch (error) {
      setMessage(screenSafeMessage(error))
    } finally {
      if (showPending) setPending(false)
    }
  }

  useEffect(() => {
    if (auto && comparison) void run(false)
    // Auto is deliberately keyed to the 30-block refresh bucket, not every block.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick])

  async function simulate() {
    if (
      !env?.lab ||
      !env.wrappedNative ||
      !tokenOut ||
      !tokenIn ||
      !tokenInMeta ||
      !venues.length ||
      !comparison
    )
      return
    if (!same(tokenIn, env.wrappedNative)) return
    setPending(true)
    setMessage('')
    try {
      const amountIn = parseAmount(amount, tokenInMeta.decimals)
      const next = await runSimulation({
        lab: env.lab,
        wrappedNative: env.wrappedNative,
        tokenOut,
        amountIn,
        venues,
        gasPerFrame,
        blockNumber: comparison.blockNumber,
        walletAccount: wallet.account,
        walletBalance: wallet.balance,
      })
      setSimulation(next)
    } catch (error) {
      setMessage(screenSafeMessage(error))
    } finally {
      setPending(false)
    }
  }

  if (!env) return <div className="router-missing">loading ROUTER.EXE…</div>
  if (!env.lab) return <div className="router-missing">{ROUTER_COPY.noDriver}</div>
  if (!pairs.length) return <div className="router-missing">{ROUTER_COPY.noVenues}</div>

  const selectedReport = comparison?.reports[selected]
  const selectedVenue = venues[selected]
  const top =
    comparison && comparison.winner !== UINT256_MAX
      ? (comparison.reports[Number(comparison.winner)]?.amountOut ?? 0n)
      : 0n
  const selectedError = selectedReport ? decodeAdapterError(selectedReport.revertSelector) : undefined
  const requestGas = compareGas(Math.max(1, venues.length), gasPerFrame, probeStatic)
  const scopeAllowed = Boolean(env.wrappedNative && tokenIn && same(tokenIn, env.wrappedNative))
  const trace =
    comparison && tokenInMeta && tokenOutMeta
      ? traceLines({
          comparison,
          venues,
          tokenInSymbol: tokenInMeta.symbol,
          tokenOutSymbol: tokenOutMeta.symbol,
          amountText: amount,
          outputDecimals: tokenOutMeta.decimals,
          formatOutput: formatAmount,
        })
      : []

  return (
    <div className="router-program">
      <IntroBar lead={ROUTER_COPY.lead} monad={ROUTER_COPY.monad} rules={ROUTER_COPY.rules} />
      <div className="router-badges">
        <span className="hw-source source-spec">{ROUTER_COPY.draft}</span>
        <span className="hw-source source-config">
          {env.mock ? ROUTER_COPY.mock : ROUTER_COPY.thirdParty}
        </span>
      </div>
      <Tabs tabs={['ROUTING', 'QUOTE SCOPE']} active={tab} onChange={setTab} />
      <div className="router-scroll">
        <div className="router-main-grid">
          <GroupBox title="INPUT DEVICE">
            <label className="router-field">
              Pair
              <select value={pairIndex} onChange={(event) => setPairIndex(Number(event.target.value))}>
                {pairs.map((item, index) => (
                  <option key={`${item.token0}-${item.token1}`} value={index}>
                    {symbolOf(item.token0)} / {symbolOf(item.token1)}
                  </option>
                ))}
              </select>
            </label>
            <div className="router-direction">
              <code>{tokenInMeta?.symbol ?? short(tokenIn ?? '')}</code>
              <Button onClick={() => setReverse((value) => !value)}>⇄</Button>
              <code>{tokenOutMeta?.symbol ?? short(tokenOut ?? '')}</code>
            </div>
            <label className="router-field">
              Amount
              <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
            </label>
            <label className="router-field">
              Gas / frame
              <select
                value={gasPerFrame.toString()}
                onChange={(event) => setGasPerFrame(BigInt(event.target.value))}
              >
                {GAS_OPTIONS.map((gas) => (
                  <option key={gas.toString()} value={gas.toString()}>
                    {Number(gas / 1_000_000n)}M
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={probeStatic}
                onChange={(event) => setProbeStatic(event.target.checked)}
              />{' '}
              STATICCALL probe
            </label>
            {config.chainId === 143 && (
              <label>
                <input
                  type="checkbox"
                  checked={crossCheck}
                  onChange={(event) => setCrossCheck(event.target.checked)}
                />{' '}
                cross-check with Monoper
              </label>
            )}
            <label>
              <input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} />{' '}
              Auto · 30 blocks
            </label>
            <Button primary disabled={pending || !tokenInMeta || !tokenOutMeta} onClick={() => void run()}>
              {pending ? 'RUNNING…' : 'RUN'}
            </Button>
            <p className="router-request">
              eth_call {formatGas(requestGas)} gas
              {requestGas > LOW_GAS_POOL_LIMIT ? ' · above 8.1M, slower on public RPCs' : ''}
            </p>
          </GroupBox>

          <GroupBox title="ROUTING BUS">
            <div className="router-table router-table-head">
              <b>venue</b>
              <b>status</b>
              <b>output</b>
              <b>Δ top bps</b>
              <b>quote gas</b>
              <b>static</b>
              <b>swapData</b>
            </div>
            {venues.map((venue, index) => {
              const report = comparison?.reports[index]
              const winning = comparison?.winner === BigInt(index)
              return (
                <button
                  key={venue.adapter}
                  className={`router-table router-row ${selected === index ? 'selected' : ''}`}
                  onClick={() => setSelected(index)}
                >
                  <span>
                    {venue.label}
                    {winning ? <em>{ROUTER_COPY.highest}</em> : null}
                  </span>
                  <span>{report ? statusLabel(report.status) : '—'}</span>
                  <span>
                    {report && report.status === 0 && tokenOutMeta
                      ? formatAmount(report.amountOut, tokenOutMeta.decimals)
                      : '—'}
                  </span>
                  <span>
                    {report && report.status === 0 && top ? pctBps(bpsDelta(report.amountOut, top)) : '—'}
                  </span>
                  <span>{report ? report.gasUsed.toLocaleString() : '—'}</span>
                  <span>{report ? staticLabel(report.staticProbe) : '—'}</span>
                  <span>{report ? report.swapDataLength.toString() : '—'}</span>
                </button>
              )
            })}
            {monoper && tokenOutMeta && (
              <p className="router-note">
                Monoper (independent onchain router), same block: selects{' '}
                {venues[Number(monoper.candidateIndex)]?.label ?? short(monoper.adapter)} ·{' '}
                {formatAmount(monoper.amountOut, tokenOutMeta.decimals)}
              </p>
            )}
          </GroupBox>

          <GroupBox title="FRAME">
            {!selectedVenue || !selectedReport ? (
              <p>RUN to inspect a quote frame.</p>
            ) : (
              <div className="router-frame-list">
                <span>adapter</span>
                <code>
                  {config.explorerUrl ? (
                    <a
                      href={`${config.explorerUrl}/address/${selectedVenue.adapter}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {selectedVenue.adapter}
                    </a>
                  ) : (
                    selectedVenue.adapter
                  )}
                </code>
                <span>code</span>
                <b className={`code-${codeInfo[selectedVenue.adapter.toLowerCase()]?.state ?? 'unknown'}`}>
                  {codeLabel(codeInfo[selectedVenue.adapter.toLowerCase()])}
                </b>
                <span>source</span>
                <code>{selectedVenue.source}</code>
                <span>pair / input</span>
                <code>
                  {tokenInMeta?.symbol} → {tokenOutMeta?.symbol} · {amount}
                </code>
                <span>block</span>
                <code>
                  {comparison?.blockNumber.toString()} · t={comparison?.timestamp.toString()}
                </code>
                <span>status</span>
                <b>{statusLabel(selectedReport.status)}</b>
                <span>meaning</span>
                <span>
                  {selectedError
                    ? `${selectedError.name ?? selectedError.selector} · ${selectedError.meaning ?? 'adapter-specific selector'}`
                    : selectedReport.status === 0
                      ? 'quote decoded successfully'
                      : selectedReport.status === 5 && gasPerFrame < 5_000_000n
                        ? 'used its whole gas cap; raise Gas / frame and RUN again to see whether it quotes with more'
                        : 'no adapter-specific decode'}
                </span>
                <span>revert selector</span>
                <code>{selectedReport.revertSelector}</code>
                <span>revert prefix</span>
                <code>{selectedReport.revertData === '0x' ? '—' : selectedReport.revertData}</code>
                <span>returndata</span>
                <code>{selectedReport.returnSize.toString()} bytes</code>
                <span>swapData</span>
                <code>
                  {selectedReport.swapDataLength.toString()} bytes · {selectedReport.swapDataHash}
                </code>
                <span>VALIDITY</span>
                <b>
                  {selectedReport.swapDataLength === 0n
                    ? ROUTER_COPY.validityEmpty
                    : `${ROUTER_COPY.validityOpaque}, ${selectedReport.swapDataLength} bytes`}
                </b>
                <span>STATICCALL</span>
                <b>
                  {staticLabel(selectedReport.staticProbe)}{' '}
                  {selectedReport.staticGasUsed
                    ? `· ${selectedReport.staticGasUsed.toLocaleString()} gas`
                    : ''}
                </b>
                {selectedReport.staticProbe === 2 && (
                  <span className="router-wide">{ROUTER_COPY.staticNeed}</span>
                )}
              </div>
            )}
          </GroupBox>
        </div>

        {tab === 'QUOTE SCOPE' && (
          <GroupBox title="QUOTE SCOPE">
            {!scopeAllowed ? (
              <p>available only when the input is wrapped native MON.</p>
            ) : (
              <>
                <Button disabled={pending || !comparison} onClick={() => void simulate()}>
                  RUN EXECUTION PREVIEW
                </Button>
                <div className="scope-table scope-head">
                  <b>venue</b>
                  <b>quoted</b>
                  <b>delivered</b>
                  <b>Δ bps</b>
                  <b>status</b>
                </div>
                {venues.map((venue, index) => {
                  const row = simulation?.reports[index]
                  const delta =
                    row && row.quoteStatus === 0 && row.quoted > 0n ? bpsDelta(row.delivered, row.quoted) : 0n
                  const status = !row
                    ? '—'
                    : row.quoteStatus !== 0
                      ? 'QUOTE FAILED'
                      : row.swapOk
                        ? 'SIMULATED'
                        : 'SWAP REVERTED'
                  return (
                    <div className="scope-table" key={venue.adapter}>
                      <span>{venue.label}</span>
                      <span>
                        {row && row.quoteStatus === 0 && tokenOutMeta
                          ? formatAmount(row.quoted, tokenOutMeta.decimals)
                          : '—'}
                      </span>
                      <span>
                        {row?.swapOk && tokenOutMeta
                          ? formatAmount(row.delivered, tokenOutMeta.decimals)
                          : '—'}
                      </span>
                      <span>{row?.swapOk ? pctBps(delta) : '—'}</span>
                      <span>
                        {status}
                        {row && !row.swapOk && row.swapRevertSelector !== '0x00000000'
                          ? ` · ${row.swapRevertSelector}`
                          : ''}
                      </span>
                    </div>
                  )
                })}
                <p className="router-note">{ROUTER_COPY.scopeNote}</p>
                {simulation && (
                  <p className="router-note">
                    simulation source: {simulation.source} · block {simulation.blockNumber.toString()}
                  </p>
                )}
              </>
            )}
          </GroupBox>
        )}

        <GroupBox title="TRACE">
          <pre className="router-trace">
            {trace.length ? trace.join('\n') : 'RUN to record a same-state routing trace.'}
          </pre>
        </GroupBox>
        {message && <p className="router-message">{message}</p>}
      </div>
      <footer className="router-status">
        <span>
          {comparison
            ? `block ${comparison.blockNumber} · venues ${venues.length} · 1 eth_call`
            : `venues ${venues.length} · idle`}
        </span>
        <span>{ROUTER_COPY.statusPreview}</span>
      </footer>
    </div>
  )
}
