import { describe, expect, it } from 'vitest'
import {
  EXPECTED_EXPERIMENTS,
  EXPECTED_BUDGETS,
  aggregateMatches,
  chainIntentCheck,
  parseChainId,
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
  set(PAINT, 'BASE_PIXELS_PER_HOUR', EXPECTED_BUDGETS.basePixelsPerHour)
  set(PAINT, 'PIXELS_PER_ACTIVE_DAY', EXPECTED_BUDGETS.pixelsPerActiveDay)
  set(PAINT, 'MAX_PIXELS_PER_HOUR', EXPECTED_BUDGETS.maxPixelsPerHour)
  set(PAINT, 'MIN_PIXELS_FOR_ACTIVE_DAY', EXPECTED_BUDGETS.minPixelsForActiveDay)
  set(PAINT, 'HOLDER_PIXELS_PER_DAY', EXPECTED_BUDGETS.holderPixelsPerDay)
  if (chainId === 143) {
    set(PAINT, 'SKRUMPEYS', OFFICIAL.skrumpeys)
    set(PAINT, 'MONAD_CARDS', OFFICIAL.monadCard)
    set(PAINT, 'SKRUMPEYS_PIXELS_PER_DAY', EXPECTED_BUDGETS.skrumpeysPixelsPerDay)
    set(PAINT, 'MONAD_CARD_PIXELS_PER_DAY', EXPECTED_BUDGETS.monadCardPixelsPerDay)
    code.add(OFFICIAL.skrumpeys.toLowerCase())
    code.add(OFFICIAL.monadCard.toLowerCase())
  }
  NAMES.forEach((name, index) =>
    set(PAINT, 'experimentInfo', { experiment: lab[name], name, uri: '', retired: false }, [BigInt(index)]),
  )
  ;[
    [hex(0), 'built-in'],
    [RENDERERS[0], 'diff'],
    [RENDERERS[1], 'season timelapse'],
    [RENDERERS[2], 'df1'],
  ].forEach((value, index) => set(PAINT, 'rendererInfo', value, [BigInt(index)]))

  for (const name of ['cd-burner', 'block-camera']) {
    set(lab[name], 'PAINT', PAINT)
    set(lab[name], 'LABS', LABS)
  }
  set(lab['finale auction'], 'PAINT', PAINT)
  set(lab['recycle-bin'], 'CORE', PAINT)
  for (const name of ['recycle-bin', 'cd-burner', 'block-camera'])
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
    block: async () => ({
      number: 123n,
      hash: `0x${'12'.repeat(32)}`,
      timestamp: 1_790_000_100n,
      commitment: 'finalized' as const,
    }),
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
    releases: { programs: { quests: '2026-11-08T18:00:00Z' } },
    knownProgramIds: ['paint', 'quests', 'auction'],
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
      ...entries.filter((e: any) => e.name !== 'router-lab' && e.name !== 'recycle-bin'),
      { id: 90, name: 'recycle-bin', address: hex(0x99), retired: true, hasCode: true },
      { id: 91, name: 'quests', address: hex(0x98), retired: false, hasCode: true },
      { id: 92, name: 'router-mock-venues', address: hex(0x97), retired: false, hasCode: true },
      { id: 93, name: 'mystery', address: hex(0x10), retired: false, hasCode: false },
    ]
    const result = analyzeExperiments(broken, { chainId: 143 })
    expect(result.missing).toEqual(['router-lab'])
    expect(result.retiredExpected).toEqual(['recycle-bin'])
    expect(result.duplicateActiveNames).toEqual(['quests'])
    expect(result.duplicateActiveAddresses.length).toBe(1)
    expect(result.testOnlyOnMainnet).toEqual(['router-mock-venues'])
    expect(result.unexpected).toEqual(['mystery'])
    expect(result.noCode).toEqual(['mystery'])
    // the app resolves a duplicated name to its last active entry
    expect(result.resolved.quests.address).toBe(hex(0x98))
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
          quests: '2026-11-08T18:00:00Z',
          auction: '2026-01-01T00:00:00Z',
          nope: '2027-01-01',
          paint: 'soon',
        },
      },
      ['quests', 'auction', 'paint'],
      NOW,
    )
    const byId = Object.fromEntries(result.rows.map((row: any) => [row.id, row]))
    expect(byId.quests.status).toBe('OK')
    expect(byId.quests.hidden).toBe(true)
    expect(byId.auction.status).toBe('WARN')
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
    // Foundry's spelling of the flag must not echo the URL (it can carry an API key).
    expect(parseArgs(['--rpc-url=https://rpc.example/v2/SECRETKEY']).unknown).toEqual(['--rpc-url'])
  })
})

describe('launch doctor: full run against fixtures', () => {
  it('passes a correctly wired local deployment with zero FAIL', async () => {
    const result = await run(healthy())
    const fails = result.sections.flatMap((s: any) => s.checks).filter((c: any) => c.status === 'FAIL')
    expect(fails).toEqual([])
    expect(result.exitCode).toBe(0)
    expect(find(result, 'PASS', 'Visual pins used').value).toBe('9 / 16')
    expect(find(result, 'PASS', 'Visual pins remaining').value).toBe('7')
    expect(find(result, 'OPERATOR', 'Sources').value).toBe('MATCH')
    expect(find(result, 'FREEZE READINESS', 'Experiments state').value).toContain('INTENTIONAL')
    expect(find(result, 'FREEZE READINESS', 'Experiments state').status).toBe('OK')
    expect(find(result, 'FREEZE READINESS', 'Renderers state').status).toBe('WARN')
    expect(find(result, 'QUESTS', 'CARD CARRIER').status).toBe('OK')
    expect(find(result, 'CHAIN', 'Finalized certification block').status).toBe('OK')
    expect(find(result, 'CHAIN', 'EIP-2935 history behaviour').value).toBe('TESTNET CHECK REQUIRED')
  })

  it('fails closed on mainnet when the certification anchor is not Finalized', async () => {
    const fixture = healthy(143)
    const base = readerFor(fixture)
    const result = await run(fixture, {
      reader: {
        ...base,
        block: async () => ({
          number: 123n,
          hash: `0x${'34'.repeat(32)}`,
          timestamp: 1_790_000_100n,
          commitment: 'proposed',
        }),
      },
    })
    expect(find(result, 'CHAIN', 'Finalized certification block').status).toBe('FAIL')
    expect(result.exitCode).toBe(1)
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

  it('checks the mainnet partner bonus addresses and exact smaller quotas', async () => {
    const fixture = healthy(143)
    fixture.reads.set(key(lab['card-drv'], 'MONAD_CARD'), OFFICIAL.monadCard)
    fixture.reads.set(key(lab['system-event'], 'FEED'), OFFICIAL.monUsdFeed)
    fixture.code.add(OFFICIAL.monUsdFeed.toLowerCase())
    const result = await run(fixture)
    expect(find(result, 'CORE', 'Pixel budgets').status).toBe('OK')
    expect(find(result, 'CORE', 'Skrumpeys bonus').status).toBe('OK')
    expect(find(result, 'CORE', 'Skrumpeys bonus').value).toContain('+128 px/day')
    expect(find(result, 'CORE', 'Monad Cards bonus').status).toBe('OK')
    expect(find(result, 'CORE', 'Monad Cards bonus').value).toContain('+128 px/day')

    fixture.reads.set(key(PAINT, 'SKRUMPEYS_PIXELS_PER_DAY'), 512n)
    const bad = await run(fixture)
    expect(find(bad, 'CORE', 'Skrumpeys bonus').status).toBe('FAIL')
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
    const index = NAMES.indexOf('recycle-bin')
    fixture.reads.set(key(PAINT, 'experimentInfo', [BigInt(index)]), {
      experiment: lab['recycle-bin'],
      name: 'recycle-bin',
      uri: '',
      retired: true,
    })
    fixture.reads.set(key(lab['cd-burner'], 'experimentId'), (1n << 256n) - 1n)
    const result = await run(fixture)
    expect(find(result, 'REGISTRY', 'Expected but retired').value).toBe('recycle-bin')
    expect(find(result, 'WIRING', 'cd-burner experiment id').value).toBe('not bound')
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
    expect(human).toContain('r3OS LAUNCH DOCTOR')
    expect(human).toContain('RESULT')
    expect(human).not.toContain('rpc.example')
  })
})

describe('launch doctor: chain intent', () => {
  it('parses --expected-chain strictly, with env fallback and CLI override', () => {
    expect(parseArgs(['--expected-chain', '143']).expectedChain).toBe(143)
    expect(parseArgs(['--expected-chain=10143']).expectedChain).toBe(10143)
    expect(parseArgs([], { EXPECTED_CHAIN_ID: '143' }).expectedChain).toBe(143)
    expect(parseArgs(['--expected-chain', '10143'], { EXPECTED_CHAIN_ID: '143' }).expectedChain).toBe(10143)
    for (const bad of ['foo', '143abc', '-1', '0', 'NaN', '0143', '1.5', ' ', '9007199254740993']) {
      const args = parseArgs(['--expected-chain', bad])
      expect(args.errors?.length, bad).toBe(1)
      expect(args.expectedChain, bad).toBeUndefined()
    }
    expect(parseArgs(['--expected-chain']).errors).toEqual(['invalid --expected-chain: value missing'])
    expect(parseArgs([], { EXPECTED_CHAIN_ID: 'abc' }).errors?.length).toBe(1)
    expect(parseArgs([], { EXPECTED_CHAIN_ID: '' }).errors).toBeUndefined()
    expect(parseChainId('143')).toBe(143)
    expect(parseChainId(undefined)).toBeUndefined()
  })

  it('classifies intent independently of the actual chain', () => {
    expect(chainIntentCheck({ actual: 143, expected: 143 }).status).toBe('OK')
    expect(chainIntentCheck({ actual: 10143, expected: 143 }).status).toBe('FAIL')
    expect(chainIntentCheck({ actual: 31337, expected: undefined }).status).toBe('WARN')
    expect(chainIntentCheck({ actual: undefined, expected: 143 }).status).toBe('UNKNOWN')
  })

  it('A. healthy local with matching intent: no chain FAIL', async () => {
    const result = await run(healthy(31337), { expectedChain: 31337 })
    expect(find(result, 'CHAIN', 'Chain match').status).toBe('OK')
    expect(result.summary.FAIL).toBe(0)
    expect(result.exitCode).toBe(0)
    expect(result.chain).toEqual({ id: 31337, name: 'local/other', expectedId: 31337, matchesExpected: true })
  })

  it('B. wrong chain: FAIL, exit 1, and no mainnet rules applied to testnet data', async () => {
    const result = await run(healthy(10143), { expectedChain: 143 })
    expect(find(result, 'CHAIN', 'Chain match').status).toBe('FAIL')
    expect(result.exitCode).toBe(1)
    expect(result.chain.matchesExpected).toBe(false)
    // actual chain is 10143: the mock card / feed are judged as off-mainnet, not as wrong mainnet addresses
    expect(find(result, 'CARD.DRV', 'Monad Card').value).toContain('off-mainnet')
    expect(find(result, 'SYSTEM EVENT', 'Feed').value).toContain('off-mainnet')
    const json = JSON.parse(toJson(result))
    expect(json.chain).toMatchObject({ id: 10143, expectedId: 143, matchesExpected: false })
  })

  it('C. no expected chain: visible WARN that does not change the exit code', async () => {
    const result = await run(healthy(31337))
    const intent = find(result, 'CHAIN', 'Chain intent')
    expect(intent.status).toBe('WARN')
    expect(intent.value).toBe('not specified')
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(toJson(result)).chain).toMatchObject({ expectedId: null, matchesExpected: null })
    expect(formatHuman(result)).toContain('expected not specified')
  })
})

describe('launch doctor: aggregates never hide uncertainty', () => {
  it('aggregateMatches: mismatch dominates, unresolved stays UNKNOWN, only full match is OK', () => {
    expect(aggregateMatches({ matched: 15, mismatched: 0, unresolved: 0 })).toEqual({
      status: 'OK',
      value: 'MATCH',
    })
    expect(aggregateMatches({ matched: 14, mismatched: 1, unresolved: 0 }).status).toBe('FAIL')
    expect(aggregateMatches({ matched: 14, mismatched: 0, unresolved: 1 })).toEqual({
      status: 'UNKNOWN',
      value: '14 match · 1 unresolved',
    })
    expect(aggregateMatches({ matched: 13, mismatched: 1, unresolved: 1 })).toEqual({
      status: 'FAIL',
      value: '13 match · 1 mismatch · 1 unresolved',
    })
    expect(aggregateMatches({ matched: 0, mismatched: 0, unresolved: 3 }).status).toBe('UNKNOWN')
  })

  it('D. one Operator source unreadable: row UNKNOWN, aggregate UNKNOWN (never MATCH)', async () => {
    const fixture = healthy()
    fixture.reads.delete(key(lab['operator-record'], 'BLOCK_CAMERA'))
    const result = await run(fixture, { expectedChain: 31337 })
    expect(find(result, 'OPERATOR', '→ BLOCK_CAMERA').status).toBe('UNKNOWN')
    expect(find(result, 'OPERATOR', '→ PAINT').status).toBe('OK')
    const sources = find(result, 'OPERATOR', 'Sources')
    expect(sources.status).toBe('UNKNOWN')
    expect(sources.value).not.toBe('MATCH')
    expect(result.exitCode).toBe(0)
  })

  it('expected registry source missing → UNKNOWN; several unknowns stay UNKNOWN', async () => {
    const fixture = healthy()
    const index = NAMES.indexOf('block-camera')
    fixture.reads.set(key(PAINT, 'experimentInfo', [BigInt(index)]), {
      experiment: lab['block-camera'],
      name: 'block-camera',
      uri: '',
      retired: true,
    })
    fixture.reads.delete(key(lab['operator-record'], 'RECYCLE_BIN'))
    const result = await run(fixture)
    expect(find(result, 'OPERATOR', '→ BLOCK_CAMERA').status).toBe('UNKNOWN')
    expect(find(result, 'OPERATOR', 'Sources')).toMatchObject({
      status: 'UNKNOWN',
      value: '7 match · 2 unresolved',
    })
  })

  it('E/F. a mismatch dominates an unreadable source: aggregate FAIL with both counts', async () => {
    const fixture = healthy()
    fixture.reads.set(key(lab['operator-record'], 'AUCTION'), hex(0xbad))
    fixture.reads.delete(key(lab['operator-record'], 'QUESTS'))
    const result = await run(fixture)
    expect(find(result, 'OPERATOR', '→ AUCTION').status).toBe('FAIL')
    expect(find(result, 'OPERATOR', '→ QUESTS').status).toBe('UNKNOWN')
    expect(find(result, 'OPERATOR', 'Sources')).toMatchObject({
      status: 'FAIL',
      value: '7 match · 1 mismatch · 1 unresolved',
    })
    expect(result.exitCode).toBe(1)
  })

  it('an unreadable registry slot makes absence unproven instead of OK or FAIL', async () => {
    const fixture = healthy()
    fixture.reads.delete(key(PAINT, 'experimentInfo', [BigInt(NAMES.indexOf('router-lab'))]))
    const result = await run(fixture)
    expect(find(result, 'REGISTRY', 'Unreadable entries').status).toBe('UNKNOWN')
    const missing = find(result, 'REGISTRY', 'Missing expected')
    expect(missing.status).toBe('UNKNOWN')
    expect(missing.value).toContain('router-lab')
    expect(find(result, 'REGISTRY', 'Duplicate active names').status).toBe('UNKNOWN')
  })

  it('an unreadable renderer slot makes a missing renderer UNKNOWN, not FAIL', async () => {
    const fixture = healthy()
    fixture.reads.delete(key(PAINT, 'rendererInfo', [3n]))
    const result = await run(fixture)
    expect(find(result, 'RENDERERS', 'Expected renderers').status).toBe('UNKNOWN')
    expect(find(result, 'FREEZE READINESS', 'Renderers expected entries').status).toBe('UNKNOWN')
  })

  it('an unreadable quest keeps a not-found CARD CARRIER UNKNOWN', async () => {
    const fixture = healthy()
    fixture.reads.delete(key(lab.quests, 'questInfo', [1n]))
    const result = await run(fixture)
    expect(find(result, 'QUESTS', 'CARD CARRIER').status).toBe('UNKNOWN')
  })

  it('unknown adapter hashes keep the mainnet hash summary UNKNOWN', async () => {
    const fixture = healthy(143)
    const adapter = hex(0x5000)
    fixture.code.add(adapter)
    const reader = {
      ...readerFor(fixture),
      codeHash: async () => {
        throw new Error('rpc down')
      },
    }
    const result = await runDoctor({
      reader,
      paint: PAINT,
      expectedOwner: OWNER,
      expectedChain: 143,
      venues: [{ label: 'a', adapter, expectedCodeHash: `0x${'00'.repeat(32)}` }],
      mrcRevision: '6e4f8633',
      now: NOW,
    })
    expect(find(result, 'ROUTER', 'a').status).toBe('UNKNOWN')
    expect(find(result, 'ROUTER', 'Code hash mismatches').status).toBe('UNKNOWN')
  })

  it('an unreadable chain id never applies or skips mainnet rules silently', async () => {
    const fixture = healthy(143)
    const reader = {
      ...readerFor(fixture),
      chainId: async () => {
        throw new Error('nope')
      },
    }
    const result = await runDoctor({ reader, paint: PAINT, expectedChain: 143, now: NOW })
    expect(find(result, 'CHAIN', 'Chain match').status).toBe('UNKNOWN')
    expect(find(result, 'CARD.DRV', 'Monad Card').status).toBe('UNKNOWN')
    expect(find(result, 'SYSTEM EVENT', 'Feed').status).toBe('UNKNOWN')
    expect(find(result, 'ROUTER', 'Adapters').status).toBe('UNKNOWN')
  })
})
