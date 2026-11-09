import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { manifestSummary, parseEvents, parseManifest } from './wallet-manifest-lib.mjs'

const A = '0x00000000000000000000000000000000000000a1'
const B = '0x00000000000000000000000000000000000000b2'

describe('public wallet manifest and event windows', () => {
  it('splits excluded wallets from AI agents and refuses duplicates', () => {
    const manifest = parseManifest(
      JSON.stringify({
        version: 1,
        groups: [
          {
            id: 'builder',
            treatment: 'excluded',
            wallets: [{ address: A.toUpperCase().replace('0X', '0x') }],
          },
          { id: 'agents', treatment: 'agents', wallets: [{ address: B, name: 'harlan.r3' }] },
        ],
      }),
    )
    expect(manifest.exclude).toEqual([A])
    expect(manifest.agents).toEqual([B])
    expect(manifestSummary(manifest).map((g) => g.wallets)).toEqual([1, 1])
    const twice = {
      version: 1,
      groups: [{ id: 'x', treatment: 'excluded', wallets: [{ address: A }, { address: A }] }],
    }
    expect(() => parseManifest(JSON.stringify(twice))).toThrow(/listed twice/)
    expect(() =>
      parseManifest(JSON.stringify({ version: 1, groups: [{ id: 'x', treatment: 'maybe' }] })),
    ).toThrow(/treatment/)
  })

  it('the published manifest is valid: every group, 46 excluded wallets and the 77 AGENT.EXE agents', () => {
    const manifest = parseManifest(readFileSync('docs/wallets.json', 'utf8'))
    expect(manifestSummary(manifest).map((g) => [g.id, g.wallets])).toEqual([
      ['project', 1],
      ['builder', 1],
      ['judges', 5],
      ['r3tards-team', 4],
      ['anons', 34],
      ['agent-exe-infra', 1],
      ['agents', 77],
    ])
    expect(manifest.exclude).toHaveLength(46)
    expect(manifest.agents).toHaveLength(77)
  })

  it('reads the published events file', () => {
    const list = parseEvents(readFileSync('docs/events.json', 'utf8'))
    expect(list.filter((event) => event.kind === 'storm')).toHaveLength(21)
    expect(list.find((event) => event.id === 'agent-exe-1')).toMatchObject({
      start: 1793876400,
      end: 1794135600,
    })
    expect(() => parseEvents(JSON.stringify({ version: 1, events: [{ id: 'x', start: 1 }] }))).toThrow(
      /either/,
    )
  })
})
