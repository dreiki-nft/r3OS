import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { screenSafeMessage } from '../chain/errors'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import {
  clearPerf,
  formatPerfReport,
  getPerfSnapshot,
  subscribePerf,
  summarizePerf,
} from '../chain/perf'
import {
  actionRpcEndpointLabel,
  formatActionRpcReport,
  getActionRpcSnapshot,
  probeActionRpcs,
  subscribeActionRpc,
} from '../chain/actionRpc'
import type { HardwareSource } from '../chain/monadHardware'
import { closeWindow } from '../os/windows'
import { playSound } from '../os/sound'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { Tabs } from '../os/ui/Tabs'
import { blockModeLabel, eventLabel, formatReport, type DxDiagInput } from './diagnostics'
import { loadDxDiag } from './loadDxDiag'
import '../monadhw/monadhw.css'
import './diagnostics.css'

const TABS = ['System', 'Drivers', 'Monad', 'Performance']

function Badge({ source }: { source: HardwareSource }) {
  return <span className={`hw-source source-${source}`}>{source}</span>
}

function Row({ label, value, source }: { label: string; value: ReactNode; source?: HardwareSource }) {
  return (
    <div className="dxdiag-row">
      <b>{label}</b>
      <span>{value}</span>
      {source ? <Badge source={source} /> : <span />}
    </div>
  )
}

const yesNo = (value?: boolean) => (value == null ? 'unknown' : value ? 'yes' : 'no')
const deviceSource = (state: string): HardwareSource =>
  state === 'present' ? 'onchain' : state === 'absent' ? 'absent' : 'unknown'

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Clipboard API blocked (permissions / insecure context): fall back to a hidden textarea.
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

export function DxDiagProgram() {
  const [tab, setTab] = useState('System')
  const [data, setData] = useState<DxDiagInput>()
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState('')
  const [step, setStep] = useState('')
  const perf = useSyncExternalStore(subscribePerf, getPerfSnapshot)
  const perfRows = useMemo(() => summarizePerf(perf.samples), [perf.version, perf.samples])
  const actionRpc = useSyncExternalStore(subscribeActionRpc, getActionRpcSnapshot)

  const load = useCallback(async (force: boolean) => {
    setLoading(true)
    setNote('')
    try {
      setData(await loadDxDiag(force, setStep))
    } catch (error) {
      setNote(`could not read: ${screenSafeMessage(error).slice(0, 120)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  // Load once on open. REFRESH is the only other read: DXDIAG never polls.
  useEffect(() => {
    void load(false)
  }, [load])

  // Block number, clock mode and block time come from the app's existing block clock (no extra RPC), so
  // they stay current while the rest of the report is a one-shot read.
  const blockSnapshot = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const view = useMemo<DxDiagInput | undefined>(
    () =>
      data && {
        ...data,
        block: {
          number: blockSnapshot.block > 0n ? blockSnapshot.block : undefined,
          mode: blockSnapshot.mode,
          blockTimeMs: blockSnapshot.block > 0n ? blockSnapshot.blockTimeMs : undefined,
        },
      },
    [data, blockSnapshot.block, blockSnapshot.mode, blockSnapshot.blockTimeMs],
  )

  const copy = async () => {
    if (!view) return
    const ok = await copyText(`${formatReport(view)}\n\n${formatPerfReport(perf)}`)
    playSound(ok ? 'confirm' : 'error')
    setNote(ok ? 'report copied to the clipboard' : 'copy failed: select the report text manually')
  }

  const d = view
  return (
    <div className="dxdiag-program">
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <p className="dxdiag-intro">
        This tool reports what this browser is connected to and which r3tardOS components it can see. It reads
        once when opened; press Refresh to read again. It never signs or sends anything.
      </p>
      <div className="dxdiag-body">
        {!d ? (
          <div className="dxdiag-loading">
            <p>{loading ? step || 'collecting information…' : note || 'no data'}</p>
            {loading && (
              <div className="dxdiag-progress" role="progressbar" aria-label="collecting information" />
            )}
          </div>
        ) : tab === 'System' ? (
          <>
            <GroupBox title="System Information">
              <Row label="Version" value={`r3tardOS 98 · app ${d.appVersion}`} source="config" />
              <Row label="Build" value={d.buildId ?? 'unknown'} source={d.buildId ? 'config' : 'unknown'} />
              <Row label="Chain" value={`${d.chain.name} · ${d.chain.id}`} source="config" />
              {d.chain.client && <Row label="Client" value={d.chain.client} source="onchain" />}
              <Row
                label="Block"
                value={d.block.number == null ? 'unknown' : d.block.number.toLocaleString('en-US')}
                source={d.block.number == null ? 'unknown' : 'onchain'}
              />
              <Row
                label="Block time"
                value={
                  d.block.blockTimeMs == null ? 'unknown' : `${(d.block.blockTimeMs / 1000).toFixed(2)} s`
                }
                source={d.block.blockTimeMs == null ? 'unknown' : 'measured'}
              />
              <Row label="Block clock" value={blockModeLabel(d.block.mode)} source="measured" />
              <Row label="Deploy block" value={d.deployBlock.toString()} source="config" />
            </GroupBox>
            <GroupBox title="RPC">
              <Row label="HTTP endpoints" value={d.rpc.httpEndpoints} source="config" />
              <Row
                label="WebSocket"
                value={d.rpc.wsConfigured ? 'configured' : 'not configured'}
                source="config"
              />
              <Row
                label="Multicall3"
                value={
                  !d.rpc.multicallConfigured
                    ? 'not configured'
                    : d.rpc.multicallPresent == null
                      ? 'configured · code unknown'
                      : d.rpc.multicallPresent
                        ? 'code present'
                        : 'configured · no code'
                }
                source={d.rpc.multicallPresent == null ? 'config' : 'onchain'}
              />
              <Row
                label="RPC stats"
                value={
                  d.rpcStats
                    ? `${Object.values(d.rpcStats.counts).reduce((a, b) => a + b, 0)} calls in the current ${d.rpcStats.windowSeconds} s window (DEV)`
                    : 'development instrumentation disabled'
                }
                source={d.rpcStats ? 'measured' : undefined}
              />
            </GroupBox>
            <GroupBox title="Contracts">
              <Row label="Paint" value={d.contracts.paint ?? 'not configured'} source="config" />
              <Row
                label="R3TARDS"
                value={d.contracts.r3tards ?? 'unknown'}
                source={d.contracts.r3tards ? 'onchain' : 'unknown'}
              />
              <Row
                label="Painter Pass"
                value={d.contracts.pass ?? 'unknown'}
                source={d.contracts.pass ? 'onchain' : 'unknown'}
              />
              <Row
                label="Experiments"
                value={d.contracts.experimentCount ?? 'unknown'}
                source={d.contracts.experimentCount == null ? 'unknown' : 'onchain'}
              />
              <Row
                label="Renderers frozen"
                value={yesNo(d.contracts.renderersFrozen)}
                source={d.contracts.renderersFrozen == null ? 'unknown' : 'onchain'}
              />
              <Row
                label="Experiments frozen"
                value={yesNo(d.contracts.experimentsFrozen)}
                source={d.contracts.experimentsFrozen == null ? 'unknown' : 'onchain'}
              />
            </GroupBox>
          </>
        ) : tab === 'Drivers' ? (
          <GroupBox title="Drivers">
            {d.drivers.map((driver) => (
              <Row
                key={driver.key}
                label={driver.label}
                value={
                  <>
                    <span className={`dxdiag-state state-${driver.state.replace(' ', '-')}`}>
                      {driver.state}
                    </span>
                    {driver.address ? <code> {driver.address}</code> : null}
                  </>
                }
                source={driver.source}
              />
            ))}
            <Row
              label="Card"
              value={
                d.card.context === 'unknown' ? d.card.driver : `${d.card.driver} · ${d.card.context} card`
              }
              source={
                d.card.context === 'official' ? 'spec' : d.card.context === 'mock' ? 'config' : 'unknown'
              }
            />
            <Row
              label="System event"
              value={eventLabel(d.systemEvent)}
              source={d.systemEvent === 'unknown' ? 'unknown' : 'onchain'}
            />
          </GroupBox>
        ) : tab === 'Monad' ? (
          <GroupBox title="Monad devices">
            <Row
              label="Staking 0x1000"
              value={d.hardware.staking}
              source={deviceSource(d.hardware.staking)}
            />
            <Row
              label="Reserve 0x1001"
              value={d.hardware.reserve}
              source={deviceSource(d.hardware.reserve)}
            />
            <Row
              label="History (EIP-2935)"
              value={d.hardware.history}
              source={deviceSource(d.hardware.history)}
            />
            <Row label="P256 0x0100" value={d.hardware.p256} source={deviceSource(d.hardware.p256)} />
            {d.hardware.romContracts != null && (
              <Row
                label="Contract ROM"
                value={`${d.hardware.romContracts} contracts measured`}
                source="measured"
              />
            )}
            <p className="dxdiag-note">
              presence only: Explore Monad › System Information has the full probes and their sources.
            </p>
          </GroupBox>
        ) : (
          <>
            <GroupBox title="Action RPC health">
              {actionRpc.endpoints.length ? (
                actionRpc.endpoints.map((endpoint) => {
                  const cooling = endpoint.cooldownUntil != null && endpoint.cooldownUntil > Date.now()
                  const state = cooling
                    ? 'cooldown'
                    : endpoint.samples === 0
                      ? 'unmeasured'
                      : endpoint.consecutiveFailures
                        ? 'degraded'
                        : 'healthy'
                  const latency = endpoint.ewmaMs == null ? '—' : `${endpoint.ewmaMs.toFixed(0)} ms EWMA`
                  return (
                    <Row
                      key={endpoint.index}
                      label={actionRpcEndpointLabel(endpoint.index)}
                      value={`${state} · ${latency} · ok ${endpoint.successes} · fail ${endpoint.failures}`}
                      source="measured"
                    />
                  )
                })
              ) : (
                <p className="dxdiag-note">no HTTP action endpoints configured.</p>
              )}
              <p className="dxdiag-note">
                Live Mode signs locally and redundantly broadcasts the same raw transaction to the configured HTTP
                endpoints. Endpoint URLs are never shown here or copied into the report.
              </p>
            </GroupBox>
            <GroupBox title="Local action timings">
              {perfRows.length ? (
                perfRows.map((row) => (
                  <Row
                    key={row.key}
                    label={`${row.kind} · ${row.label}`}
                    value={`n ${row.count} · last ${row.last.toFixed(0)} ms · p50 ${row.p50.toFixed(0)} ms · p95 ${row.p95.toFixed(0)} ms · max ${row.max.toFixed(0)} ms`}
                    source="measured"
                  />
                ))
              ) : (
                <p className="dxdiag-note">
                  no measurements yet. Open programs, request quotes, and send testnet actions; timings appear here immediately.
                </p>
              )}
              <p className="dxdiag-note">
                local browser measurements only. Nothing in this tab is uploaded or written onchain. Wallet signing time includes the time you spend approving the wallet prompt.
              </p>
            </GroupBox>
          </>
        )}
      </div>
      <footer className="dxdiag-footer">
        <span className="dxdiag-status">{loading ? 'reading…' : note}</span>
        <Button
          onClick={() => void load(true)}
          disabled={loading}
          title={loading ? 'still reading…' : 'read everything again'}
        >
          Refresh
        </Button>
        {tab === 'Performance' && (
          <>
            <Button onClick={() => void probeActionRpcs()} title="ping each configured action RPC once">
              Probe RPCs
            </Button>
            <Button onClick={clearPerf} disabled={!perf.samples.length} title="clear local timing samples">
              Clear timings
            </Button>
          </>
        )}
        <Button
          onClick={() => void copy()}
          disabled={!d || loading}
          title={!d || loading ? 'wait until the report is ready' : 'copy a plain-text report'}
        >
          Copy Report
        </Button>
        <Button primary onClick={() => closeWindow('dxdiag')}>
          Exit
        </Button>
      </footer>
    </div>
  )
}
