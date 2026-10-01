import { describe, expect, it } from 'vitest'
import {
  EXPECTED_EXPERIMENTS,
  EXPECTED_STAMP_SOURCES,
  OFFICIAL,
  OPERATOR_SOURCES,
  analyzeExperiments,
  boundString,
  codeHashState,
  exitCodeFor,
  formatHuman,
  ownershipCheck,
  parseArgs,
  passCapacity,
  questMatchesCardCarrier,
  redact,
  rendererReadiness,
  runDoctor,
  summarize,
  toJson,
  validateReleases,
} from './launch-doctor-lib.mjs'

// ---------------------------------------------------------------------------
// Fixture deployment: a fake read-only chain with the full snapshot suite wired correctly.
// ---------------------------------------------------------------------------

const hex = (n: number) => `0x${n.toString(16).padStart(40, '0')}`
const OWNER = hex(0xaaaa)
const PAINT = hex(0x1000)
const PASS = hex(0x1001)
const LABS = hex(0x1002)
const R3 = hex(0x1003)
const MOCK_CARD = hex(0x1004)
const FEED = hex(0x1005)
const RENDERERS = [hex(0x2001), hex(0x2002), hex(0x2003)]
const lab: Record<string, string> = {}
EXPECTED_EXPERIMENTS.forEach(
  (entry: { name: string }, index: number) => (lab[entry.name] = hex(0x3000 + index)),
)
lab['router-mock-venues'] = hex(0x3100)
const NAMES = [...EXPECTED_EXPERIMENTS.map((entry: { name: string }) => entry.name), 'router-mock-venues']
const NOW = Date.parse('2026-10-01T00:00:00Z')

type Fixture = {
  chainId: number
  reads: Map<string, unknown>
  code: Set<string>
  calls: Map<string, string>
}

const key = (address: string, fn: string, args: unknown[] = []) =>
  `${address.toLowerCase()}|${fn}|${args.map(String).join(',')}`

function healthy(chainId = 31337): Fixture {
  const reads = new Map<string, unknown>()
  const set = (address: string, fn: string, value: unknown, args: unknown[] = []) =>
    reads.set(key(address, fn, args), value)
  const code = new Set<string>(
    [PAINT, PASS, LABS, R3, MOCK_CARD, FEED, ...RENDERERS, ...Object.values(lab)].map((a) => a.toLowerCase()),
  )
  code.add(OFFICIAL.multicall3.toLowerCase())
  code.add('0x0000f90827f1c53a10cb7a02335b175320002935')

  set(PAINT, 'owner', OWNER)
  set(PAINT, 'pendingOwner', hex(0))
  set(PAINT, 'R3TARDS', R3)
  set(PAINT, 'painterPass', PASS)
  set(PAINT, 'currentSeason', 0n)
  set(PAINT, 'experimentCount', BigInt(NAMES.length))
  set(PAINT, 'rendererCount', 4n)
  set(PAINT, 'renderersFrozen', false)
  set(PAINT, 'experimentsFrozen', false)
  set(PAINT, 'ownerOf', OWNER, [0n])
  set(PAINT, 'ROYALTY_RECEIVER', OWNER)
  set(PAINT, 'ROYALTY_BPS', 500)
  set(PAINT, 'SEASON_START', 1_790_000_000n)
  set(PAINT, 'SEASON_LENGTH', 2_592_000n)
  NAMES.forEach((name, index) =>
    set(PAINT, 'experimentInfo', { experiment: lab[name], name, uri: '', retired: false }, [BigInt(index)]),
  )
  ;[
    [hex(0), 'built-in'],
    [RENDERERS[0], 'diff'],
    [RENDERERS[1], 'season timelapse'],
    [RENDERERS[2], 'df1'],
  ].forEach((value, index) => set(PAINT, 'rendererInfo', value, [BigInt(index)]))

  for (const name of ['flipbook', 'forks', 'sleepwalker', 'cd-burner', 'block-camera']) {
    set(lab[name], 'PAINT', PAINT)
    set(lab[name], 'LABS', LABS)
  }
  for (const name of ['weeds', 'brushes', 'finale auction']) set(lab[name], 'PAINT', PAINT)
  set(lab['recycle-bin'], 'CORE', PAINT)
  for (const name of ['flipbook', 'forks', 'sleepwalker', 'recycle-bin', 'cd-burner', 'block-camera'])
    set(lab[name], 'experimentId', BigInt(NAMES.indexOf(name)))

  for (const address of [LABS, PASS, lab.quests]) {
    set(address, 'owner', OWNER)
    set(address, 'pendingOwner', hex(0))
  }
  set(LABS, 'CORE', PAINT)
  set(LABS, 'ROYALTY_RECEIVER', OWNER)
  set(LABS, 'ROYALTY_BPS', 500n)
  set(PASS, 'PAINT', PAINT)
  set(PASS, 'stampSourceCount', BigInt(EXPECTED_STAMP_SOURCES.length))
  EXPECTED_STAMP_SOURCES.forEach((name: string, index: number) => {
    set(PASS, 'stampSource', lab[name], [BigInt(index)])
    set(PASS, 'stampSourceEnabled', true, [BigInt(index)])
  })
  set(lab.quests, 'PAINT', PAINT)
  set(lab.quests, 'questCount', 2n)
  set(lab.quests, 'questInfo', ['FIRST STROKE', 0, 0, []], [0n])
  set(
    lab.quests,
    'questInfo',
    [
      'CARD CARRIER',
      0,
      0,
      [
        { target: MOCK_CARD, selector: '0x70a08231', word: 0, op: 0, threshold: 1n },
        { target: PAINT, selector: '0x4d97621f', word: 2, op: 0, threshold: 143n },
      ],
    ],
    [1n],
  )

  const card = lab['card-drv']
  set(card, 'MONAD_CARD', MOCK_CARD)
  set(card, 'FORMAT_VERSION', 1n)
  set(card, 'BUS_WORD', 24n)
  set(card, 'BUS_WORDS', 4n)
  set(lab['block-camera'], 'CARD_MEMORY', card)

  const operator = lab['operator-record']
  set(operator, 'SUBSYSTEM_COUNT', 16n)
  set(operator, 'IDENTITY_MASK', 1n << 15n)
  const targets: Record<string, string> = {
    'core:paint': PAINT,
    'core:pass': PASS,
    'card:monad-card': MOCK_CARD,
  }
  for (const source of OPERATOR_SOURCES)
    set(operator, source.fn, targets[source.target] ?? lab[source.target])

  const event = lab['system-event']
  set(event, 'FEED', FEED)
  set(event, 'THRESHOLD_MILLI_USD', 333n)
  set(event, 'MAX_AGE', 90_000n)
  set(event, 'activated', false)
  set(event, 'activatedBlock', 0)
  set(event, 'activationAnswer', 0n)
  set(event, 'FEED_DECIMALS', 8)
  set(event, 'condition', [false, true, 3_000_000n, 1_790_000_000n, 2n])
  set(FEED, 'description', 'MOCK MON / USD')
  set(FEED, 'decimals', 8)

  const router = lab['router-lab']
  set(router, 'INTERFACE', 'MRC-17 DRAFT (MIPs#91 6e4f8633)')
  set(router, 'MAX_VENUES', 8n)
  set(router, 'MIN_GAS_PER_FRAME', 50_000n)
  set(router, 'MAX_GAS_PER_FRAME', 5_000_000n)

  return { chainId, reads, code, calls: new Map() }
}

function readerFor(fixture: Fixture) {
  return {
    chainId: async () => fixture.chainId,
    block: async () => ({ number: 123n, timestamp: 1_790_000_100n }),
    code: async (address: string) => (fixture.code.has(address.toLowerCase()) ? '0x6000' : '0x'),
    codeHash: async (address: string) => `0x${address.slice(2).padStart(64, '0')}`,
    read: async (address: string, fragment: string, args: unknown[] = []) => {
      const fn = /function (\w+)\(/.exec(fragment)![1]
      const k = key(address, fn, args)
      if (!fixture.reads.has(k)) throw new Error(`execution reverted (${fn})`)
      return fixture.reads.get(k)
    },
    call: async (to: string) => {
      const value = fixture.calls.get(to.toLowerCase())
      if (value == null) throw new Error('call failed')
      return value
    },
  }
}

async function run(fixture: Fixture, extra: Record<string, unknown> = {}) {
  return runDoctor({
    reader: readerFor(fixture),
    paint: PAINT,
    expectedOwner: OWNER,
    releases: { programs: { forks: '2026-11-08T18:00:00Z' } },
    knownProgramIds: ['paint', 'forks', 'brushes'],
    venues: [],
    mrcRevision: '6e4f86333923f0c4ec77bc92b3702f1b21f37446',
    now: NOW,
    ...extra,
  })
}

function find(result: any, section: string, label: string) {
  return result.sections.find((s: any) => s.name === section)?.checks.find((c: any) => c.label === label)
}

// ---------------------------------------------------------------------------

describe('launch doctor: pure helpers', () => {
  it('aggregates statuses and derives the exit code from FAIL only', () => {
    const summary = summarize([{ status: 'OK' }, { status: 'WARN' }, { status: 'UNKNOWN' }, { status: 'OK' }])
    expect(summary).toEqual({ OK: 2, WARN: 1, FAIL: 0, UNKNOWN: 1 })
    expect(exitCodeFor(summary)).toBe(0)
    expect(exitCodeFor({ ...summary, FAIL: 1 })).toBe(1)
  })

  it('compares ownership including pending two-step transfers', () => {
    expect(ownershipCheck({ owner: OWNER, pendingOwner: hex(0), expected: OWNER }).status).toBe('OK')
    expect(ownershipCheck({ owner: hex(1), pendingOwner: hex(0), expected: OWNER }).status).toBe('FAIL')
    expect(ownershipCheck({ owner: hex(1), pendingOwner: OWNER, expected: OWNER }).status).toBe('WARN')
    expect(ownershipCheck({ owner: undefined, expected: OWNER }).status).toBe('UNKNOWN')
    expect(ownershipCheck({ owner: hex(0), expected: OWNER }).status).toBe('FAIL')
  })

  it('detects duplicate, missing, retired and test-only registry entries', () => {
    const entries = EXPECTED_EXPERIMENTS.map((entry: { name: string }, id: number) => ({
      id,
      name: entry.name,
      address: hex(0x10 + id),
      retired: false,
      hasCode: true,
    }))
    expect(analyzeExperiments(entries).missing).toEqual([])
    const broken = [
      ...entries.filter((e: any) => e.name !== 'router-lab' && e.name !== 'weeds'),
      { id: 90, name: 'weeds', address: hex(0x99), retired: true, hasCode: true },
      { id: 91, name: 'flipbook', address: hex(0x98), retired: false, hasCode: true },
      { id: 92, name: 'router-mock-venues', address: hex(0x97), retired: false, hasCode: true },
      { id: 93, name: 'mystery', address: hex(0x10), retired: false, hasCode: false },
    ]
    const result = analyzeExperiments(broken, { chainId: 143 })
    expect(result.missing).toEqual(['router-lab'])
    expect(result.retiredExpected).toEqual(['weeds'])
    expect(result.duplicateActiveNames).toEqual(['flipbook'])
    expect(result.duplicateActiveAddresses.length).toBe(1)
    expect(result.testOnlyOnMainnet).toEqual(['router-mock-venues'])
    expect(result.unexpected).toEqual(['mystery'])
    expect(result.noCode).toEqual(['mystery'])
    // the app resolves a duplicated name to its last active entry
    expect(result.resolved.flipbook.address).toBe(hex(0x98))
  })

  it('classifies runtime code hashes', () => {
    const h = `0x${'ab'.repeat(32)}`
    expect(codeHashState({ hasCode: true, codeHash: h, expected: h.toUpperCase().replace('0X', '0x') })).toBe(
      'MATCH',
    )
    expect(codeHashState({ hasCode: true, codeHash: `0x${'cd'.repeat(32)}`, expected: h })).toBe('DIFFERS')
    expect(codeHashState({ hasCode: false, expected: h })).toBe('NO CODE')
    expect(codeHashState({ hasCode: undefined, expected: h })).toBe('UNKNOWN')
  })

  it('computes visual Pass pin capacity and metadata-only overflow', () => {
    expect(passCapacity({ sourceCount: 8 })).toMatchObject({ used: 14, remaining: 2, metadataOnly: 0 })
    expect(passCapacity({ sourceCount: 12 })).toMatchObject({ used: 16, remaining: 0, metadataOnly: 2 })
  })

  it('checks renderer completeness', () => {
    expect(
      rendererReadiness({ names: ['built-in', 'diff', 'season timelapse', 'df1'], frozen: false }).complete,
    ).toBe(true)
    expect(rendererReadiness({ names: ['built-in', 'diff'], frozen: true }).missing).toEqual([
      'season timelapse',
      'df1',
    ])
  })

  it('validates the release schedule', () => {
    const result = validateReleases(
      {
        programs: {
          forks: '2026-11-08T18:00:00Z',
          brushes: '2026-01-01T00:00:00Z',
          nope: '2027-01-01',
          paint: 'soon',
        },
      },
      ['forks', 'brushes', 'paint'],
      NOW,
    )
    const byId = Object.fromEntries(result.rows.map((row: any) => [row.id, row]))
    expect(byId.forks.status).toBe('OK')
    expect(byId.forks.hidden).toBe(true)
    expect(byId.brushes.status).toBe('WARN')
    expect(byId.nope.status).toBe('FAIL')
    expect(byId.paint.status).toBe('FAIL')
    expect(validateReleases({ programs: [] }, [], NOW).ok).toBe(false)
  })

  it('redacts endpoints and bounds untrusted strings', () => {
    const rpc = 'https://mainnet.example/v2/SECRETKEY123456'
    const text = redact(`rpc ${rpc} and wss://ws.example/abc and private_key=0x${'1'.repeat(64)}`, [rpc])
    expect(text).not.toContain('SECRETKEY')
    expect(text).not.toContain('ws.example')
    expect(text).not.toContain('1111111111111111')
    expect(boundString(`a\u0000b${'x'.repeat(500)}`, 10)).toHaveLength(10)
    expect(boundString('a\u0007b')).toBe('ab')
  })

  it('matches CARD CARRIER conditions exactly', () => {
    const quest = {
      conditions: [
        { target: MOCK_CARD, selector: '0x70a08231', word: 0, op: 0, threshold: 1n },
        { target: PAINT, selector: '0x4d97621f', word: 2, op: 0, threshold: 143n },
      ],
    }
    expect(questMatchesCardCarrier(quest, { monadCard: MOCK_CARD, paint: PAINT })).toBe(true)
    expect(questMatchesCardCarrier(quest, { monadCard: hex(5), paint: PAINT })).toBe(false)
  })

  it('parses CLI arguments with env fallback and never needs the RPC in output', () => {
    const args = parseArgs(['--paint', PAINT, '--json'], { RPC_URL: 'http://x', EXPECTED_OWNER: OWNER })
    expect(args).toMatchObject({ paint: PAINT, json: true, rpc: 'http://x', expectedOwner: OWNER })
    expect(parseArgs(['--what']).unknown).toEqual(['--what'])
  })
})

describe('launch doctor: full run against fixtures', () => {
  it('passes a correctly wired local deployment with zero FAIL', async () => {
    const result = await run(healthy())
    const fails = result.sections.flatMap((s: any) => s.checks).filter((c: any) => c.status === 'FAIL')
    expect(fails).toEqual([])
    expect(result.exitCode).toBe(0)
    expect(find(result, 'PASS', 'Visual pins used').value).toBe('14 / 16')
    expect(find(result, 'PASS', 'Visual pins remaining').value).toBe('2')
    expect(find(result, 'OPERATOR', 'Sources').value).toBe('MATCH')
    expect(find(result, 'FREEZE READINESS', 'Experiments state').value).toContain('INTENTIONAL')
    expect(find(result, 'FREEZE READINESS', 'Experiments state').status).toBe('OK')
    expect(find(result, 'FREEZE READINESS', 'Renderers state').status).toBe('WARN')
    expect(find(result, 'QUESTS', 'CARD CARRIER').status).toBe('OK')
    expect(find(result, 'CHAIN', 'EIP-2935 history behaviour').value).toBe('TESTNET CHECK REQUIRED')
  })

  it('fails an Operator Record source that does not match the live registry', async () => {
    const fixture = healthy()
    fixture.reads.set(key(lab['operator-record'], 'BLOCK_CAMERA'), hex(0xbad))
    const result = await run(fixture)
    expect(find(result, 'OPERATOR', '→ BLOCK_CAMERA').status).toBe('FAIL')
    expect(find(result, 'OPERATOR', 'Sources').status).toBe('FAIL')
    expect(result.exitCode).toBe(1)
  })

  it('fails a wrong card / feed on chain 143 and checks mainnet adapters by code hash', async () => {
    const fixture = healthy(143)
    const adapter = hex(0x5000)
    fixture.code.add(adapter)
    const result = await run(fixture, {
      venues: [
        { label: 'match', adapter, expectedCodeHash: `0x${adapter.slice(2).padStart(64, '0')}` },
        { label: 'gone', adapter: hex(0x5001), expectedCodeHash: `0x${'00'.repeat(32)}` },
      ],
    })
    expect(find(result, 'CARD.DRV', 'Monad Card').status).toBe('FAIL')
    expect(find(result, 'SYSTEM EVENT', 'Feed').status).toBe('FAIL')
    expect(find(result, 'ROUTER', 'match').value).toContain('MATCH')
    expect(find(result, 'ROUTER', 'gone').value).toContain('NO CODE')
    expect(find(result, 'ROUTER', 'Code hash mismatches').value).toBe('1')
    expect(find(result, 'REGISTRY', 'Test-only on mainnet').status).toBe('WARN')
  })

  it('turns malformed or reverting reads into UNKNOWN instead of crashing', async () => {
    const fixture = healthy()
    fixture.reads.delete(key(lab['system-event'], 'condition'))
    fixture.reads.delete(key(PAINT, 'rendererCount'))
    const result = await run(fixture)
    expect(find(result, 'SYSTEM EVENT', 'Latest round').status).toBe('UNKNOWN')
    expect(find(result, 'RENDERERS', 'Expected renderers').status).toBe('UNKNOWN')
  })

  it('flags a retired expected entry and an unbound experiment id', async () => {
    const fixture = healthy()
    const index = NAMES.indexOf('weeds')
    fixture.reads.set(key(PAINT, 'experimentInfo', [BigInt(index)]), {
      experiment: lab.weeds,
      name: 'weeds',
      uri: '',
      retired: true,
    })
    fixture.reads.set(key(lab.forks, 'experimentId'), (1n << 256n) - 1n)
    const result = await run(fixture)
    expect(find(result, 'REGISTRY', 'Expected but retired').value).toBe('weeds')
    expect(find(result, 'WIRING', 'forks experiment id').value).toBe('not bound')
  })

  it('stops after CHAIN/CORE when Paint has no code', async () => {
    const fixture = healthy()
    fixture.code.delete(PAINT.toLowerCase())
    const result = await run(fixture)
    expect(find(result, 'CORE', 'Paint').status).toBe('FAIL')
    expect(result.sections.map((s: any) => s.name)).toEqual(['CHAIN', 'CORE'])
  })

  it('serialises JSON and human output without the RPC URL', async () => {
    const result = await run(healthy())
    const rpc = 'https://rpc.example/key/abcdef0123456789'
    const json = JSON.parse(toJson(result, { secrets: [rpc] }))
    expect(json.readOnly).toBe(true)
    expect(json.chain.id).toBe(31337)
    expect(json.block).toBe('123')
    expect(json.summary.FAIL).toBe(0)
    expect(Array.isArray(json.sections)).toBe(true)
    const human = formatHuman(result, { secrets: [rpc] })
    expect(human).toContain('R3TARDS LAUNCH DOCTOR')
    expect(human).toContain('RESULT')
    expect(human).not.toContain('rpc.example')
  })
})
