import { describe, expect, it } from 'vitest'
import {
  dotted,
  firstSeen,
  lastActive,
  recordRows,
  visibleSubsystemMask,
  visibleSubsystems,
  seasonOf,
  subsystemCount,
  type OperatorFacts,
  type OperatorRecordData,
} from './operatorRecord'
import { OPERATOR_COPY, SUBSYSTEM_LABELS } from '../operator/copy'

function facts(overrides: Partial<OperatorFacts> = {}): OperatorFacts {
  return {
    activeDays: 0n,
    daysPainted: 0n,
    totalPixels: 0n,
    framesMinted: 0n,
    firstPaintBlock: 0n,
    lastPaintBlock: 0n,
    passClaimed: false,
    questsCompleted: 0n,
    flipbookFrames: 0n,
    flipbookLastBlock: 0n,
    weedsPlants: 0n,
    weedsTicks: 0n,
    weedsLastBlock: 0n,
    forksPainted: 0n,
    lastForkBlock: 0n,
    dnaCatches: 0n,
    dnaVerified: 0n,
    dnaLastBlock: 0n,
    bidsPlaced: 0n,
    auctionsWon: 0n,
    dreamingDays: 0n,
    recycled: 0n,
    lastRecycleBlock: 0n,
    lastCaptureBlock: 0n,
    kernelRuns: 0n,
    lastKernelBlock: 0n,
    pageNonEmpty: false,
    cardFound: false,
    cardId: 0n,
    cardFormatted: false,
    cardWrites: 0n,
    cardFirstWriteBlock: 0n,
    cardLastWriteBlock: 0n,
    monadCardBalance: 0n,
    answeredMask: (1n << 16n) - 1n,
    ...overrides,
  }
}

function record(overrides: Partial<OperatorRecordData> = {}): OperatorRecordData {
  return {
    firstRecordBlock: 0n,
    lastRecordBlock: 0n,
    observedMask: 0n,
    seasonsObserved: 0n,
    firstObserved: Array.from({ length: 16 }, () => 0n),
    firstSeenBlock: 0n,
    ...overrides,
  }
}

describe('operator record helpers', () => {
  it('renders a fresh wallet as known zeroes without inventing history', () => {
    const rows = recordRows(facts(), record())
    expect(rows.find((row) => row.label === OPERATOR_COPY.rows.firstSeen)?.value).toBe(OPERATOR_COPY.unknown)
    expect(rows.find((row) => row.label === OPERATOR_COPY.rows.pixelsPainted)).toMatchObject({
      value: '0',
      source: 'ONCHAIN',
    })
    expect(rows.find((row) => row.label === SUBSYSTEM_LABELS[11])?.value).toBe(OPERATOR_COPY.notUsed)
    // PAGE.EXE and CARD.DRV were retired from the interface: no rows for them.
    expect(rows.find((row) => row.label === SUBSYSTEM_LABELS[13])).toBeUndefined()
    expect(rows.find((row) => row.label === SUBSYSTEM_LABELS[14])).toBeUndefined()
  })

  it('renders exact paint history separately from observed history', () => {
    const f = facts({
      activeDays: 12n,
      totalPixels: 10_432n,
      framesMinted: 4n,
      firstPaintBlock: 123_456n,
      lastPaintBlock: 150_860n,
    })
    const r = record({
      firstRecordBlock: 150_000n,
      lastRecordBlock: 151_000n,
      observedMask: 1n,
      firstObserved: [150_000n, ...Array.from({ length: 15 }, () => 0n)],
      firstSeenBlock: 123_456n,
      firstPaintSeason: 0n,
      lastPaintSeason: 2n,
    })
    const rows = recordRows(f, r)
    expect(rows.find((row) => row.label === OPERATOR_COPY.rows.firstSeen)?.value).toContain('123456')
    expect(rows.find((row) => row.label === OPERATOR_COPY.rows.paintSeasons)?.value).toBe('S1 → S3')
    expect(rows.find((row) => row.label === OPERATOR_COPY.rows.pixelsPainted)?.value).toBe('10,432')
  })

  it('renders a full wallet from live facts without a progress denominator', () => {
    const f = facts({
      firstPaintBlock: 10n,
      lastPaintBlock: 100n,
      framesMinted: 2n,
      questsCompleted: 3n,
      flipbookFrames: 1n,
      weedsPlants: 1n,
      forksPainted: 1n,
      dnaCatches: 1n,
      bidsPlaced: 1n,
      dreamingDays: 1n,
      recycled: 1n,
      lastCaptureBlock: 90n,
      kernelRuns: 1n,
      pageNonEmpty: true,
      cardFound: true,
      cardFormatted: true,
      cardWrites: 7n,
      monadCardBalance: 1n,
    })
    const rows = recordRows(f, record({ firstSeenBlock: 10n }))
    // Only interface subsystems count: PAINT, FRAMES, QUESTS, AUCTION, RECYCLE BIN, BLOCK CAMERA (the retired
    // FLIPBOOK, WEEDS, FORKS, BLOCK DNA, SLEEPWALKER, KERNEL DEBUGGER, PAGE.EXE and CARD.DRV are not counted).
    expect(rows.find((row) => row.label === OPERATOR_COPY.rows.subsystemsUsed)?.value).toBe('6')
    expect(visibleSubsystemMask((1n << 16n) - 1n)).toBe(
      (1n << 0n) |
        (1n << 1n) |
        (1n << 2n) |
        (1n << 3n) |
        (1n << 8n) |
        (1n << 10n) |
        (1n << 11n) |
        (1n << 15n),
    )
    expect(visibleSubsystems().map((subsystem) => subsystem.id)).toEqual([0, 1, 2, 3, 8, 10, 11, 15])
    expect(rows.find((row) => row.label === SUBSYSTEM_LABELS[15])?.value).toBe(OPERATOR_COPY.present)
  })

  it('shows UNKNOWN when a source did not answer', () => {
    const f = facts({ answeredMask: 1n })
    const rows = recordRows(f, record())
    expect(rows.find((row) => row.label === SUBSYSTEM_LABELS[11])).toMatchObject({
      value: OPERATOR_COPY.unknown,
      source: 'UNKNOWN',
    })
    expect(rows.find((row) => row.label === OPERATOR_COPY.rows.subsystemsUsed)).toMatchObject({
      value: OPERATOR_COPY.unknown,
      source: 'UNKNOWN',
    })
    expect(rows.find((row) => row.label === OPERATOR_COPY.rows.lastActive)).toMatchObject({
      value: OPERATOR_COPY.unknown,
      source: 'UNKNOWN',
    })
  })

  it('answers LAST ACTIVE and SUBSYSTEMS USED on mainnet, where retired experiments never reply', () => {
    // Mainnet: only the live subsystems (and CARD.DRV) answer; FLIPBOOK, WEEDS, FORKS, BLOCK DNA, SLEEPWALKER,
    // KERNEL DEBUGGER and PAGE.EXE have no contract there.
    const mainnetMask = [0, 1, 2, 3, 8, 10, 11, 14, 15].reduce((mask, id) => mask | (1n << BigInt(id)), 0n)
    const f = facts({
      answeredMask: mainnetMask,
      firstPaintBlock: 112455428n,
      lastPaintBlock: 112559000n,
      framesMinted: 2n,
      questsCompleted: 1n,
      lastCaptureBlock: 112559857n,
    })
    const rows = recordRows(f, record())
    expect(rows.find((row) => row.label === OPERATOR_COPY.rows.lastActive)).toMatchObject({
      value: `${OPERATOR_COPY.block} 112559857`,
      source: 'DERIVED',
    })
    expect(rows.find((row) => row.label === OPERATOR_COPY.rows.subsystemsUsed)).toMatchObject({
      value: '4',
      source: 'DERIVED',
    })
  })

  it('excludes identity from subsystem count', () => {
    expect(subsystemCount(1n << 15n)).toBe(0)
    expect(subsystemCount((1n << 0n) | (1n << 3n) | (1n << 15n))).toBe(2)
  })

  it('derives last active and first seen only from real block facts', () => {
    const f = facts({
      firstPaintBlock: 20n,
      lastPaintBlock: 50n,
      lastCaptureBlock: 90n,
      cardFormatted: true,
      cardFirstWriteBlock: 15n,
      cardLastWriteBlock: 70n,
    })
    const r = record({ firstObserved: [0n, 0n, 12n, ...Array.from({ length: 13 }, () => 0n)] })
    expect(lastActive(f)).toBe(90n)
    expect(firstSeen(f, r)).toBe(12n)
  })

  it('derives paint season from chain timestamps', () => {
    const start = 1_000n
    const season = 30n * 24n * 60n * 60n
    expect(seasonOf(start - 1n, start)).toBe(0n)
    expect(seasonOf(start, start)).toBe(0n)
    expect(seasonOf(start + season, start)).toBe(1n)
    expect(seasonOf(start + season * 3n + 5n, start)).toBe(3n)
  })

  it('formats dotted rows deterministically', () => {
    expect(dotted('A', 'B', 8)).toBe('A .... B')
  })
})
