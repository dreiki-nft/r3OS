import { describe, expect, it } from 'vitest'
import {
  blockModeLabel,
  driverState,
  eventLabel,
  formatReport,
  normalizeBuildId,
  redactReport,
  type DxDiagInput,
} from './diagnostics'

function input(overrides: Partial<DxDiagInput> = {}): DxDiagInput {
  return {
    appVersion: '0.1.0',
    chain: { id: 143, name: 'Monad' },
    block: { number: 109_483_102n, mode: 'live', blockTimeMs: 400 },
    deployBlock: 100n,
    rpc: { httpEndpoints: 2, wsConfigured: true, multicallConfigured: true, multicallPresent: true },
    contracts: {
      paint: '0x0000000000000000000000000000000000001000',
      r3tards: '0x0000000000000000000000000000000000001001',
      pass: '0x0000000000000000000000000000000000001002',
      experimentCount: 16,
      renderersFrozen: false,
      experimentsFrozen: false,
    },
    drivers: [
      {
        key: 'block-camera',
        label: 'Block Camera',
        state: 'installed',
        source: 'onchain',
        address: '0x0000000000000000000000000000000000002000',
      },
      { key: 'card-drv', label: 'CARD.DRV', state: 'not installed', source: 'onchain' },
    ],
    hardware: { staking: 'present', reserve: 'present', history: 'present', p256: 'present' },
    systemEvent: 'armed',
    card: { driver: 'not installed', context: 'unknown' },
    ...overrides,
  }
}

describe('DXDIAG report model', () => {
  it('derives driver states from registry + code facts only', () => {
    expect(driverState(undefined, undefined)).toBe('not installed')
    expect(driverState('0x01', true)).toBe('installed')
    expect(driverState('0x01', false)).toBe('not installed')
    expect(driverState('0x01', undefined)).toBe('unknown')
  })

  it('formats a deterministic plain-text report', () => {
    const a = formatReport(input())
    expect(formatReport(input())).toBe(a)
    expect(a.split('\n')[0]).toBe('R3TARDOS DXDIAG')
    expect(a).toContain('chain: Monad (143)')
    expect(a).toContain('block: 109483102')
    expect(a).toContain('block mode: live (websocket)')
    expect(a).toContain('multicall: present')
    expect(a).toContain('block camera: installed')
    expect(a).toContain('card.drv: not installed')
    expect(a).not.toContain('ROUTER')
  })

  it('reports offline / polling honestly and omits production rpc stats', () => {
    const offline = formatReport(input({ block: { mode: 'offline' } }))
    expect(offline).toContain('block: unknown')
    expect(offline).toContain('block mode: offline')
    expect(offline).toContain('block time: unknown')
    expect(blockModeLabel('polling')).toBe('polling (http)')
    expect(offline).toContain('rpc stats: development instrumentation disabled')
    const dev = formatReport(
      input({ rpcStats: { windowSeconds: 10, counts: { eth_call: 3, eth_blockNumber: 2 } } }),
    )
    expect(dev).toContain('rpc calls (dev): 5 in the current 10 s window')
  })

  it('handles missing contracts', () => {
    const report = formatReport(
      input({
        contracts: {},
        rpc: { httpEndpoints: 1, wsConfigured: false, multicallConfigured: false },
      }),
    )
    expect(report).toContain('paint: not configured')
    expect(report).toContain('experiments: unknown')
    expect(report).toContain('renderers frozen: unknown')
    expect(report).toContain('ws configured: no')
    expect(report).toContain('multicall: not configured')
    expect(report).not.toContain('ROUTER')
  })

  it('labels every System Event state', () => {
    expect(eventLabel('no-driver')).toBe('not installed')
    expect(eventLabel('armed')).toBe('armed')
    expect(eventLabel('condition-met')).toBe('condition met (not activated)')
    expect(eventLabel('activated')).toBe('activated')
    expect(eventLabel('unknown')).toBe('unknown')
    expect(formatReport(input({ systemEvent: 'activated' }))).toContain('system event: activated')
  })

  it('never contains RPC URLs or secrets', () => {
    const secret = 'https://monad-mainnet.provider.example/v2/abcdef0123456789'
    const leaky = input({ chain: { id: 143, name: `Monad ${secret}` } })
    const report = formatReport(leaky, [secret])
    expect(report).not.toContain('provider.example')
    expect(report).not.toContain('abcdef0123456789')
    expect(redactReport('ws wss://x.example/key and http://127.0.0.1:8545')).toBe(
      'ws [redacted-url] and [redacted-url]',
    )
    // the report never includes a wallet / connected account field
    expect(formatReport(input())).not.toMatch(/wallet|account/i)
  })

  it('reports the build id separately from the app version, honestly when absent', () => {
    const withBuild = formatReport(input({ buildId: 'snapshot-24' }))
    const lines = withBuild.split('\n')
    expect(lines[1]).toBe('version: r3tardOS 98 · app 0.1.0')
    expect(lines[2]).toBe('build: snapshot-24')
    expect(formatReport(input()).split('\n')[2]).toBe('build: unknown')
  })

  it('normalizes VITE_BUILD_ID as public but untrusted text', () => {
    expect(normalizeBuildId('a84f392')).toBe('a84f392')
    expect(normalizeBuildId('  snapshot-24  ')).toBe('snapshot-24')
    expect(normalizeBuildId('')).toBeUndefined()
    expect(normalizeBuildId(undefined)).toBeUndefined()
    expect(normalizeBuildId('   ')).toBeUndefined()
    expect(normalizeBuildId('x'.repeat(200))).toHaveLength(64)
    expect(normalizeBuildId('v1 <script>\u0007')).toBe('v1script')
    expect(normalizeBuildId('https://user:token@host.example/build')).toBeUndefined()
    const report = formatReport(input({ buildId: normalizeBuildId('https://secret.example/k') }))
    expect(report).toContain('build: unknown')
    expect(report).not.toContain('secret.example')
  })
})
