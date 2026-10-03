/**
 * DXDIAG.EXE report model. Pure: no RPC, no React. `loadDxDiag` (./loadDxDiag.ts) gathers the input once;
 * this file decides labels and formats the copyable support report.
 *
 * DXDIAG answers "what is this browser connected to, and which r3tardOS components can it see?".
 * Deployment certification lives in the Launch Doctor CLI (scripts/launch-doctor.mjs), not here.
 */
import type { HardwareSource } from '../chain/monadHardware'

export type DriverState = 'installed' | 'not installed' | 'unknown'
export type DeviceState = 'present' | 'absent' | 'unknown'
export type EventState = 'no-driver' | 'armed' | 'condition-met' | 'activated' | 'unknown'

export interface DriverRow {
  key: string
  label: string
  address?: string
  state: DriverState
  source: HardwareSource
}

export interface DxDiagInput {
  appVersion: string
  /** Public VITE_BUILD_ID, normalized; undefined when not configured. */
  buildId?: string
  chain: { id: number; name: string; client?: string }
  block: { number?: bigint; mode: 'live' | 'polling' | 'offline'; blockTimeMs?: number }
  deployBlock: bigint
  rpc: {
    httpEndpoints: number
    wsConfigured: boolean
    multicallConfigured: boolean
    multicallPresent?: boolean
  }
  /** Only present in development builds, where src/chain/rpcStats.ts actually counts calls. */
  rpcStats?: { windowSeconds: number; counts: Record<string, number> }
  contracts: {
    paint?: string
    r3tards?: string
    pass?: string
    experimentCount?: number
    renderersFrozen?: boolean
    experimentsFrozen?: boolean
  }
  drivers: DriverRow[]
  hardware: {
    staking: DeviceState
    reserve: DeviceState
    history: DeviceState
    p256: DeviceState
    romContracts?: number
  }
  systemEvent: EventState
  card: { driver: DriverState; context: 'official' | 'mock' | 'unknown' }
}

/**
 * VITE_BUILD_ID is public by design but still untrusted text: keep a short, printable identifier
 * (letters, digits, `. _ - + : /`), cap it, and treat anything URL-like as not configured.
 */
export function normalizeBuildId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!text || /:\/\//.test(text)) return undefined
  const clean = text.replace(/[^A-Za-z0-9._+:/-]/g, '').slice(0, 64)
  return clean || undefined
}

export function driverState(address: string | undefined, hasCode: boolean | undefined): DriverState {
  if (!address) return 'not installed'
  if (hasCode === true) return 'installed'
  if (hasCode === false) return 'not installed'
  return 'unknown'
}

export function eventLabel(state: EventState) {
  if (state === 'no-driver') return 'not installed'
  if (state === 'condition-met') return 'condition met (not activated)'
  return state
}

export function blockModeLabel(mode: DxDiagInput['block']['mode']) {
  if (mode === 'live') return 'live (websocket)'
  if (mode === 'polling') return 'polling (http)'
  return 'offline'
}

const yesNo = (value: boolean | undefined) => (value == null ? 'unknown' : value ? 'yes' : 'no')

/**
 * Removes anything endpoint-like from a support report. Public contract addresses stay; URLs, user:pass,
 * and query-string keys never appear in DXDIAG input, but this is the last line of defence.
 */
export function redactReport(text: string, secrets: readonly string[] = []) {
  let out = text
  for (const secret of secrets) if (secret && secret.length >= 4) out = out.split(secret).join('[redacted]')
  return out.replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, '[redacted-url]')
}

export function formatReport(input: DxDiagInput, secrets: readonly string[] = []) {
  const lines: string[] = []
  const row = (label: string, value: string | number) => lines.push(`${label}: ${value}`)
  lines.push('R3TARDOS DXDIAG')
  row('version', `r3tardOS 98 · app ${input.appVersion}`)
  row('build', input.buildId ?? 'unknown')
  row('chain', `${input.chain.name} (${input.chain.id})`)
  row('block', input.block.number == null ? 'unknown' : input.block.number.toString())
  row(
    'block time',
    input.block.blockTimeMs == null
      ? 'unknown'
      : `${(input.block.blockTimeMs / 1000).toFixed(2)} s (measured)`,
  )
  row('deploy block', input.deployBlock.toString())
  lines.push('')
  lines.push('RPC')
  row('http endpoints', input.rpc.httpEndpoints)
  row('ws configured', yesNo(input.rpc.wsConfigured))
  row('block mode', blockModeLabel(input.block.mode))
  row(
    'multicall',
    !input.rpc.multicallConfigured
      ? 'not configured'
      : input.rpc.multicallPresent == null
        ? 'configured · code unknown'
        : input.rpc.multicallPresent
          ? 'present'
          : 'configured · no code',
  )
  if (input.rpcStats) {
    const total = Object.values(input.rpcStats.counts).reduce((sum, value) => sum + value, 0)
    row('rpc calls (dev)', `${total} in the current ${input.rpcStats.windowSeconds} s window`)
    for (const [method, count] of Object.entries(input.rpcStats.counts).sort((a, b) => b[1] - a[1])) {
      row(`rpc ${method}`, String(count))
    }
  } else row('rpc stats', 'development instrumentation disabled')
  lines.push('')
  lines.push('CONTRACTS')
  row('paint', input.contracts.paint ?? 'not configured')
  row('r3tards', input.contracts.r3tards ?? 'unknown')
  row('pass', input.contracts.pass ?? 'unknown')
  row('experiments', input.contracts.experimentCount ?? 'unknown')
  row('renderers frozen', yesNo(input.contracts.renderersFrozen))
  row('experiments frozen', yesNo(input.contracts.experimentsFrozen))
  lines.push('')
  lines.push('HARDWARE')
  for (const driver of input.drivers) row(driver.label.toLowerCase(), driver.state)
  row('staking device', input.hardware.staking)
  row('reserve device', input.hardware.reserve)
  row('history device', input.hardware.history)
  row('p256', input.hardware.p256)
  row('system event', eventLabel(input.systemEvent))
  row(
    'card',
    `${input.card.driver}${input.card.context === 'unknown' ? '' : ` · ${input.card.context} card`}`,
  )
  return redactReport(lines.join('\n'), secrets)
}
