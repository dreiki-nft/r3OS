import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
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

const TABS = ['System', 'Drivers', 'Monad']

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

  const load = useCallback(async (force: boolean) => {
    setLoading(true)
    setNote('')
    try {
      setData(await loadDxDiag(force))
    } catch (error) {
      setNote(`could not read: ${error instanceof Error ? error.message.slice(0, 120) : 'unknown error'}`)
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
    const ok = await copyText(formatReport(view))
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
          <p className="dxdiag-loading">{loading ? 'collecting information…' : note || 'no data'}</p>
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
        ) : (
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
              presence only: Monad Hardware has the full probes and their sources.
            </p>
          </GroupBox>
        )}
      </div>
      <footer className="dxdiag-footer">
        <span className="dxdiag-status">{loading ? 'reading…' : note}</span>
        <Button onClick={() => void load(true)} disabled={loading}>
          Refresh
        </Button>
        <Button onClick={() => void copy()} disabled={!d || loading}>
          Copy Report
        </Button>
        <Button primary onClick={() => closeWindow('dxdiag')}>
          Exit
        </Button>
      </footer>
    </div>
  )
}
