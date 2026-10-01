import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { MONAD_NAMES, config } from '../chain/config'
import { cardPropertySources, isOfficialCard, useMonadCard } from '../chain/monadCard'
import { MONAD_HW_SPEC, useMonadHardware, type HardwareSource } from '../chain/monadHardware'
import { getTxTraceSnapshot, subscribeTxTrace } from '../chain/txTrace'
import { eventState, formatUsd, useSystemEvent } from '../chain/systemEvent'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import packageJson from '../../package.json'
import { openProgram } from '../os/programs'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { HardwareBus, type HardwareDevice } from '../os/ui/HardwareBus'
import { R3TARDS_SYSTEM_EVENT_ABI } from '../lib/generated/abi'
import { DEVICE07_COPY } from '../operator/copy'
import { IntroBar } from '../os/ui/IntroBar'
import './monadhw.css'

const RULES = [
  'every status light comes from an actual probe, chain read, transaction trace or explicitly labelled protocol specification.',
  'measured values describe this RPC and this session. spec values describe Monad rules and are kept visually separate.',
  'the Drivers open the experiments that exercise storage pages, consensus capture, reserve-aware execution and CARD.DRV directly.',
] as const

const ROM_LIMIT = MONAD_HW_SPEC.contractRomBytes.value

type SourceLabel = HardwareSource | 'measured + spec' | 'onchain + spec' | ''
type HwRow = {
  key: string
  device: HardwareDevice
  label: string
  value: ReactNode
  source: SourceLabel | SourceLabel[]
}

function focusFromHash(): HardwareDevice | undefined {
  if (typeof location === 'undefined') return undefined
  const value = location.hash.split('/')[2]
  return ['clock', 'storage', 'consensus', 'execution', 'rom', 'card', 'unknown'].includes(value)
    ? (value as HardwareDevice)
    : undefined
}

function SourceBadge({ source }: { source: SourceLabel }) {
  if (!source) return null
  return (
    <span className={`hw-source source-${source.replaceAll(' ', '-').replaceAll('+', 'plus')}`}>
      {source}
    </span>
  )
}

function finalityText(trace: ReturnType<typeof getTxTraceSnapshot>['traces'][number] | undefined) {
  if (!trace) return 'no measured X-ray trace yet · proposed → voted → finalized'
  const proposed = trace.t.proposed
  const voted = trace.t.voted
  const finalized = trace.t.finalized
  if (proposed == null) return 'trace exists; proposed timing not observed yet'
  const votedMs = voted == null ? '—' : `${Math.max(0, voted - proposed).toFixed(0)} ms to voted`
  const finalMs = finalized == null ? '—' : `${Math.max(0, finalized - proposed).toFixed(0)} ms to finalized`
  return `${votedMs} · ${finalMs}`
}

function formatMilliUsd(value?: bigint) {
  if (value == null) return DEVICE07_COPY.unknown
  const whole = value / 1000n
  const fraction = (value % 1000n).toString().padStart(3, '0')
  return `$${whole}.${fraction}`
}

function eventStatusText(snapshot: ReturnType<typeof useSystemEvent>) {
  if (snapshot.loading) return DEVICE07_COPY.unknown
  const state = eventState(snapshot)
  if (state === 'no-driver') return DEVICE07_COPY.noDriver
  if (state === 'activated')
    return `${DEVICE07_COPY.activated} · ${DEVICE07_COPY.block} ${snapshot.activatedBlock}`
  if (state === 'condition-met') return DEVICE07_COPY.conditionMet
  return `${DEVICE07_COPY.armed} · ${snapshot.trigger ?? DEVICE07_COPY.triggerFallback}`
}

function feedAge(updatedAt: bigint, now: bigint) {
  if (updatedAt === 0n) return DEVICE07_COPY.feedUnavailable
  const seconds = now > updatedAt ? now - updatedAt : 0n
  if (seconds < 60n) return DEVICE07_COPY.updatedNow
  const minutes = seconds / 60n
  if (minutes < 120n) return `${minutes} ${DEVICE07_COPY.updatedMinutes}`
  return `${minutes / 60n} ${DEVICE07_COPY.updatedHours}`
}

function cardStatusText(card: ReturnType<typeof useMonadCard>) {
  if (card.status === 'present' && card.cardInfo?.exists) return 'This device is working properly.'
  if (card.status === 'no-driver') return 'The driver for this device is not installed.'
  if (card.status === 'empty' || card.status === 'no-wallet') return 'No card in this slot.'
  if (card.status === 'unknown-id') return 'Card detected; its number is not indexed yet.'
  return 'Card state unavailable.'
}

export function MonadHardwareProgram() {
  const hw = useMonadHardware()
  const card = useMonadCard()
  const systemEvent = useSystemEvent()
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const traces = useSyncExternalStore(subscribeTxTrace, getTxTraceSnapshot)
  const [focus, setFocus] = useState<HardwareDevice | undefined>(() => focusFromHash())
  const [activationQuote, setActivationQuote] = useState<ActionQuote>()
  const [activationPending, setActivationPending] = useState(false)
  const [activationMessage, setActivationMessage] = useState('')
  useEffect(() => {
    const onHash = () => setFocus(focusFromHash())
    window.addEventListener('hashchange', onHash)
    onHash()
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    setActivationQuote(undefined)
    if (eventState(systemEvent) !== 'condition-met' || !systemEvent.address || !wallet.account) return
    const eventAddress = systemEvent.address
    const account = wallet.account
    let cancelled = false
    void quoteAction({
      kind: 'estimate',
      address: eventAddress,
      abi: R3TARDS_SYSTEM_EVENT_ABI,
      functionName: 'activate',
      account,
      action: DEVICE07_COPY.activateAction,
    })
      .then((quote) => !cancelled && setActivationQuote(quote))
      .catch(() => !cancelled && setActivationQuote(undefined))
    return () => {
      cancelled = true
    }
  }, [systemEvent.address, systemEvent.activatedBlock, systemEvent.condition.met, wallet.account])

  async function activateEvent() {
    if (!systemEvent.address || !wallet.account || !activationQuote || activationPending) return
    setActivationPending(true)
    setActivationMessage('')
    try {
      await sendAction({
        kind: 'estimate',
        address: systemEvent.address,
        abi: R3TARDS_SYSTEM_EVENT_ABI,
        functionName: 'activate',
        account: wallet.account,
        quote: activationQuote,
        action: DEVICE07_COPY.activateAction,
      })
      setActivationMessage(DEVICE07_COPY.activated)
    } catch (error) {
      setActivationMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setActivationPending(false)
    }
  }

  const pageOverhead = hw.storage.overhead.value ?? 0n
  const cold =
    hw.storage.cold.value == null
      ? undefined
      : hw.storage.cold.value - (hw.storage.cold.value > pageOverhead ? pageOverhead : 0n)
  const warm =
    hw.storage.warm.value == null
      ? undefined
      : hw.storage.warm.value - (hw.storage.warm.value > pageOverhead ? pageOverhead : 0n)

  const measuredChainName = MONAD_NAMES[hw.chainId.value] ?? `Monad ${hw.chainId.value}`

  const rows = useMemo<HwRow[]>(() => {
    const romSummary = hw.rom.value.length
      ? `${hw.rom.value.length} contracts measured · ${hw.rom.value.filter((entry) => (entry.bytes ?? 0) > ROM_LIMIT).length} over limit`
      : 'no runtime sizes measured'
    return [
      {
        key: 'system',
        device: 'rom',
        label: 'System',
        value: `r3tardOS 98 · app ${packageJson.version}`,
        source: '',
      },
      {
        key: 'computer',
        device: 'rom',
        label: 'Computer',
        value: `${measuredChainName} · chain ${hw.chainId.value} · ${hw.clientVersion.value}`,
        source: hw.clientVersion.source,
      },
      {
        key: 'processor',
        device: 'rom',
        label: 'Processor',
        value: MONAD_HW_SPEC.processor.value,
        source: 'spec',
      },
      {
        key: 'clock',
        device: 'clock',
        label: 'Block clock',
        value:
          block.mode === 'offline'
            ? `not measured · spec ~${MONAD_HW_SPEC.blockTimeMs.value} ms`
            : `${block.blockTimeMs.toFixed(0)} ms EMA · spec ~${MONAD_HW_SPEC.blockTimeMs.value} ms`,
        source: block.mode === 'offline' ? 'spec' : 'measured + spec',
      },
      {
        key: 'finality',
        device: 'clock',
        label: 'Finality',
        value: finalityText(traces.traces[0]),
        source: traces.traces[0] ? 'measured + spec' : 'spec',
      },
      {
        key: 'memory',
        device: 'rom',
        label: 'Transaction memory',
        value: `${MONAD_HW_SPEC.transactionMemoryBytes.value / (1024 * 1024)} MiB · linear pricing`,
        source: 'spec',
      },
      {
        key: 'rom',
        device: 'rom',
        label: 'Contract ROM',
        value: `${ROM_LIMIT / 1024} KiB runtime limit · ${romSummary}`,
        source: hw.rom.source,
      },
      {
        key: 'storage',
        device: 'storage',
        label: 'Storage page',
        value:
          hw.storage.status === 'present'
            ? `${MONAD_HW_SPEC.storagePageBytes.value.toLocaleString()} bytes / ${MONAD_HW_SPEC.storagePageWords.value} words · cold ${cold ?? '—'} gas · warm ${warm ?? '—'} gas`
            : `${MONAD_HW_SPEC.storagePageBytes.value.toLocaleString()} bytes / ${MONAD_HW_SPEC.storagePageWords.value} words · storage probe unavailable`,
        source: hw.storage.status === 'present' ? 'measured + spec' : 'spec',
      },
      {
        key: 'staking',
        device: 'consensus',
        label: 'Staking device 0x1000',
        value:
          hw.staking.status === 'present'
            ? `epoch ${hw.staking.epoch.value ?? '—'} · delay ${hw.staking.inDelay.value ? 'yes' : 'no'} · proposer ${hw.staking.proposerValId.value == null ? 'unknown' : `validator ${hw.staking.proposerValId.value}`}`
            : hw.staking.status,
        source: hw.staking.epoch.source,
      },
      {
        key: 'reserve',
        device: 'execution',
        label: 'Reserve device 0x1001',
        value: hw.reserve.status,
        source: hw.reserve.dipped.source,
      },
      {
        key: 'history',
        device: 'clock',
        label: 'History device (EIP-2935)',
        value: `${hw.history.status} · ${MONAD_HW_SPEC.historyWindowBlocks.value.toLocaleString()}-block window`,
        source: hw.history.status === 'present' ? 'onchain + spec' : hw.history.codeBytes.source,
      },
      {
        key: 'p256',
        device: 'rom',
        label: 'Crypto P256 0x0100',
        value: hw.p256.status === 'present' ? 'built-in vector: OK' : hw.p256.status,
        source: hw.p256.verified.source,
      },

      {
        key: 'system-event',
        device: 'unknown',
        label: DEVICE07_COPY.eventRow,
        value: eventStatusText(systemEvent),
        source: systemEvent.loading ? 'unknown' : systemEvent.address ? 'onchain' : 'absent',
      },
      {
        key: 'device-07',
        device: 'unknown',
        label: `${DEVICE07_COPY.devicePrefix} ${DEVICE07_COPY.label}`,
        value: DEVICE07_COPY.name,
        source: '',
      },
      {
        key: 'card',
        device: 'card',
        label: card.cardId == null ? 'Monad Card' : `Monad Card #${card.cardId}`,
        value: cardStatusText(card),
        source: card.status === 'present' ? 'onchain' : card.status === 'no-driver' ? 'absent' : 'unknown',
      },
    ]
  }, [hw, block.blockTimeMs, block.mode, traces.version, cold, warm, card, measuredChainName, systemEvent])

  const official = isOfficialCard(hw.chainId.value, card.cardAddress)
  const cardSources = cardPropertySources({
    official,
    erc5192: card.erc5192,
    locked: card.locked,
    codeBytes: card.codeBytes,
    driverVersion: card.driverVersion,
  })
  const soulbound =
    card.erc5192 === true && card.locked != null ? (card.locked ? 'Yes' : 'No') : official ? 'Yes' : 'unknown'

  return (
    <div className="monadhw-program hardware-program">
      <IntroBar
        lead="Device Manager, except the devices are Monad."
        monad="chain probes and measured timings sit beside protocol specs instead of pretending they are the same thing."
        rules={RULES}
      />
      <HardwareBus highlight={['clock', 'storage', 'consensus', 'execution', 'rom', 'card', 'unknown']} />
      <div className="monadhw-scroll">
        <GroupBox title="System Information">
          <div className="hardware-device-list sunken">
            {rows.map((row) => (
              <div
                key={row.key}
                id={`hw-row-${row.device}`}
                className={`hardware-device-row ${focus === row.device ? 'focused' : ''}`}
              >
                <b>{row.label}</b>
                <span>{row.value}</span>
                {Array.isArray(row.source) ? (
                  <span className="hw-source-group">
                    {row.source.map((source) => (
                      <SourceBadge key={source} source={source} />
                    ))}
                  </span>
                ) : (
                  <SourceBadge source={row.source} />
                )}
              </div>
            ))}
          </div>
        </GroupBox>

        <GroupBox title={`${DEVICE07_COPY.devicePrefix} ${DEVICE07_COPY.label} · Properties`}>
          <div className="hardware-device-list sunken">
            <div className="hardware-device-row">
              <b>{DEVICE07_COPY.deviceTypeLabel}</b>
              <span>{DEVICE07_COPY.deviceType}</span>
              <SourceBadge source="" />
            </div>
            <div className="hardware-device-row">
              <b>{DEVICE07_COPY.manufacturerLabel}</b>
              <span>{DEVICE07_COPY.manufacturer}</span>
              <SourceBadge source="" />
            </div>
            <div className="hardware-device-row">
              <b>{DEVICE07_COPY.driverLabel}</b>
              <span>{DEVICE07_COPY.driver}</span>
              <SourceBadge source="" />
            </div>
            <div className="hardware-device-row">
              <b>{DEVICE07_COPY.statusLabel}</b>
              <span>
                {systemEvent.loading
                  ? DEVICE07_COPY.unknown
                  : eventState(systemEvent) === 'activated'
                    ? `${DEVICE07_COPY.activatedAtBlock} ${systemEvent.activatedBlock}`
                    : eventState(systemEvent) === 'no-driver'
                      ? DEVICE07_COPY.noDriver
                      : eventState(systemEvent) === 'condition-met'
                        ? DEVICE07_COPY.conditionMet
                        : DEVICE07_COPY.waiting}
              </span>
              <SourceBadge
                source={systemEvent.loading ? 'unknown' : systemEvent.address ? 'onchain' : 'absent'}
              />
            </div>
            <div className="hardware-device-row">
              <b>{DEVICE07_COPY.activationLabel}</b>
              <span>
                {systemEvent.loading
                  ? DEVICE07_COPY.unknown
                  : eventState(systemEvent) === 'activated'
                    ? DEVICE07_COPY.activated
                    : DEVICE07_COPY.armed}
              </span>
              <SourceBadge
                source={systemEvent.loading ? 'unknown' : systemEvent.address ? 'onchain' : 'absent'}
              />
            </div>
            <div className="hardware-device-row">
              <b>{DEVICE07_COPY.triggerLabel}</b>
              <span>{systemEvent.trigger ?? DEVICE07_COPY.unknown}</span>
              <SourceBadge source={systemEvent.address ? 'onchain' : 'unknown'} />
            </div>
            <div className="hardware-device-row">
              <b>{DEVICE07_COPY.conditionLabel}</b>
              <span>
                {systemEvent.thresholdMilliUsd == null
                  ? DEVICE07_COPY.unknown
                  : `${DEVICE07_COPY.marketCondition} ${formatMilliUsd(systemEvent.thresholdMilliUsd)}`}
              </span>
              <SourceBadge source={systemEvent.thresholdMilliUsd == null ? 'unknown' : 'config'} />
            </div>
            <div className="hardware-device-row">
              <b>{DEVICE07_COPY.feedLabel}</b>
              <span>
                {systemEvent.loading || !systemEvent.feed
                  ? DEVICE07_COPY.unknown
                  : `${systemEvent.feedDescription ?? DEVICE07_COPY.unknown} · ${
                      systemEvent.feedDecimals == null
                        ? DEVICE07_COPY.unknown
                        : formatUsd(systemEvent.condition.answer, systemEvent.feedDecimals)
                    } · ${
                      systemEvent.condition.fresh
                        ? feedAge(systemEvent.condition.updatedAt, block.timestamp)
                        : `${DEVICE07_COPY.stale} (${feedAge(systemEvent.condition.updatedAt, block.timestamp)})`
                    }`}
              </span>
              <SourceBadge source={systemEvent.feed ? 'onchain' : 'unknown'} />
            </div>
            <div className="hardware-device-row">
              <b>{DEVICE07_COPY.nextStageLabel}</b>
              <span>{DEVICE07_COPY.nextStage}</span>
              <SourceBadge source="" />
            </div>
            <div className="hardware-device-row">
              <b>{DEVICE07_COPY.operatorRecordLabel}</b>
              <span>{DEVICE07_COPY.operatorRecord}</span>
              <Button onClick={() => openProgram('pass', true, '#/pass?tab=Operator')}>
                {DEVICE07_COPY.open}
              </Button>
            </div>
          </div>
          {eventState(systemEvent) === 'condition-met' && wallet.account && (
            <div className="hw-toolbar">
              <Button
                primary
                disabled={activationPending || !activationQuote}
                onClick={() => void activateEvent()}
              >
                {DEVICE07_COPY.activateButton}
              </Button>
              <span>
                {DEVICE07_COPY.maxCost}: {activationQuote?.maxCost ?? DEVICE07_COPY.quoting}
              </span>
            </div>
          )}
          {eventState(systemEvent) === 'condition-met' && (
            <p className="hw-note">{DEVICE07_COPY.activateHelp}</p>
          )}
          {activationMessage && <p className="hw-message">{activationMessage}</p>}
        </GroupBox>

        <GroupBox title={card.cardId == null ? 'Card Properties' : `Monad Card #${card.cardId} · Properties`}>
          <div className="hardware-device-list sunken card-properties">
            <div className="hardware-device-row">
              <b>Device type</b>
              <span>Monad identity device</span>
              <SourceBadge source="spec" />
            </div>
            <div className="hardware-device-row">
              <b>Manufacturer</b>
              <span>{official ? 'Monad' : card.cardAddress ? 'unknown (mock contract)' : 'unknown'}</span>
              <SourceBadge source={cardSources.manufacturer} />
            </div>
            <div className="hardware-device-row">
              <b>Location</b>
              <span>{measuredChainName}</span>
              <SourceBadge source={hw.chainId.source} />
            </div>
            <div className="hardware-device-row">
              <b>Contract</b>
              <span>
                {card.cardAddress ? (
                  config.explorerUrl ? (
                    <a
                      href={`${config.explorerUrl}/address/${card.cardAddress}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {card.cardAddress}
                    </a>
                  ) : (
                    card.cardAddress
                  )
                ) : (
                  'unknown'
                )}
              </span>
              <SourceBadge source={card.source.contract} />
            </div>
            <div className="hardware-device-row">
              <b>Code</b>
              <span>{card.codeBytes == null ? 'unknown' : `${card.codeBytes.toLocaleString()} bytes`}</span>
              <SourceBadge source={cardSources.code} />
            </div>
            <div className="hardware-device-row">
              <b>Soulbound</b>
              <span>{soulbound}</span>
              <SourceBadge source={cardSources.soulbound} />
            </div>
            <div className="hardware-device-row">
              <b>Memory</b>
              <span>4 KiB / 128 words</span>
              <SourceBadge source="spec" />
            </div>
            <div className="hardware-device-row">
              <b>Driver</b>
              <span>
                {card.driverVersion == null ? 'CARD.DRV unavailable' : `CARD.DRV v${card.driverVersion}`}
              </span>
              <SourceBadge source={card.source.driver} />
            </div>
            <div className="hardware-device-row">
              <b>Page</b>
              <span>
                {card.cardInfo
                  ? `0x${card.cardInfo.pageIndex.toString(16)} · slot 0x${card.cardInfo.pageBaseSlot.toString(16).padStart(64, '0')}`
                  : 'unknown'}
              </span>
              <SourceBadge source={card.cardInfo ? 'onchain' : 'unknown'} />
            </div>
            <div className="hardware-device-row">
              <b>Writes</b>
              <span>
                {card.cardInfo
                  ? `${card.cardInfo.writes} · last block ${card.cardInfo.lastWriteBlock}`
                  : 'unknown'}
              </span>
              <SourceBadge source={card.cardInfo ? 'onchain' : 'unknown'} />
            </div>
          </div>
          <p className="hw-note">{cardStatusText(card)}</p>
        </GroupBox>

        <GroupBox title="Contract ROM">
          {!hw.rom.value.length ? (
            <p>runtime sizes are not available.</p>
          ) : (
            <div className="rom-list">
              {hw.rom.value.map((entry) => {
                const pct = entry.bytes == null ? undefined : (entry.bytes / ROM_LIMIT) * 100
                return (
                  <div key={`${entry.name}-${entry.address}`}>
                    <span>{entry.name}</span>
                    <code>
                      {entry.bytes == null
                        ? 'unknown'
                        : `${entry.bytes.toLocaleString()} B · ${pct!.toFixed(1)}%`}
                    </code>
                    <div className="rom-meter">
                      <i style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </GroupBox>

        <GroupBox title="Programs">
          <div className="driver-list">
            <Button onClick={() => openProgram('block-camera')}>Block Camera · CONSENSUS</Button>
            <Button onClick={() => openProgram('xray')}>Monad X-ray · BLOCKS</Button>
            <Button onClick={() => openProgram('dxdiag')}>DXDIAG.EXE · DIAGNOSTICS</Button>
          </div>
        </GroupBox>

        <p className="hw-note">
          spec references: MIP-3 transaction memory · MIP-8 storage pages · MIP-4 reserve balance · Monad
          staking, history and P256 precompile interfaces. card manufacturer/soulbound fallback claims are
          only labelled spec for the official chain-143 address. exact protocol dates and local measurements
          are recorded in docs/specs/MONAD_HW.md and docs/specs/MONAD_CARD.md.
        </p>
      </div>
    </div>
  )
}
