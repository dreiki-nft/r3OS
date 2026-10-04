import { useEffect, useState, type ReactNode } from 'react'
import { RETIRED_SUBSYSTEMS } from '../os/retired'
import { type Address } from 'viem'
import { R3OS_OPERATOR_RECORD_ABI } from '../lib/generated/abi'
import { discoverContracts, readCoreConstants } from './contracts'
import { publicClient } from './clients'
import { readHeavy, readMany } from './readMany'
import { useRefreshTick } from './refreshTick'
import type { SystemEventSnapshot } from './systemEvent'
import { eventState } from './systemEvent'
import { OPERATOR_COPY, SUBSYSTEM_LABELS } from '../operator/copy'

export type OperatorSource = 'ONCHAIN' | 'DERIVED' | 'CONFIG' | 'UNKNOWN'
export type SubsystemGroup = 'canvas' | 'labs' | 'hardware' | 'identity'

export interface OperatorFacts {
  activeDays: bigint
  daysPainted: bigint
  totalPixels: bigint
  framesMinted: bigint
  firstPaintBlock: bigint
  lastPaintBlock: bigint
  passClaimed: boolean
  questsCompleted: bigint
  flipbookFrames: bigint
  flipbookLastBlock: bigint
  weedsPlants: bigint
  weedsTicks: bigint
  weedsLastBlock: bigint
  forksPainted: bigint
  lastForkBlock: bigint
  dnaCatches: bigint
  dnaVerified: bigint
  dnaLastBlock: bigint
  bidsPlaced: bigint
  auctionsWon: bigint
  dreamingDays: bigint
  recycled: bigint
  lastRecycleBlock: bigint
  lastCaptureBlock: bigint
  kernelRuns: bigint
  lastKernelBlock: bigint
  pageNonEmpty: boolean
  cardFound: boolean
  cardId: bigint
  cardFormatted: boolean
  cardWrites: bigint
  cardFirstWriteBlock: bigint
  cardLastWriteBlock: bigint
  monadCardBalance: bigint
  answeredMask: bigint
}

export interface OperatorRecordData {
  firstRecordBlock: bigint
  lastRecordBlock: bigint
  observedMask: bigint
  seasonsObserved: bigint
  firstObserved: bigint[]
  firstSeenBlock: bigint
  firstPaintSeason?: bigint
  lastPaintSeason?: bigint
}

export interface OperatorRow {
  label: string
  value: ReactNode
  source: OperatorSource
}

export interface OperatorSnapshot {
  loading: boolean
  status: 'no-address' | 'no-driver' | 'ready'
  address?: Address
  driverAddress?: Address
  facts?: OperatorFacts
  record?: OperatorRecordData
}

const EMPTY: OperatorSnapshot = { loading: true, status: 'no-address' }

function bit(mask: bigint, id: number) {
  return (mask & (1n << BigInt(id))) !== 0n
}

export const SUBSYSTEMS = [
  {
    id: 0,
    label: SUBSYSTEM_LABELS[0],
    group: 'canvas',
    used: (f: OperatorFacts) => f.firstPaintBlock !== 0n,
  },
  { id: 1, label: SUBSYSTEM_LABELS[1], group: 'canvas', used: (f: OperatorFacts) => f.framesMinted > 0n },
  { id: 2, label: SUBSYSTEM_LABELS[2], group: 'identity', used: (f: OperatorFacts) => f.passClaimed },
  { id: 3, label: SUBSYSTEM_LABELS[3], group: 'labs', used: (f: OperatorFacts) => f.questsCompleted > 0n },
  { id: 4, label: SUBSYSTEM_LABELS[4], group: 'labs', used: (f: OperatorFacts) => f.flipbookFrames > 0n },
  {
    id: 5,
    label: SUBSYSTEM_LABELS[5],
    group: 'labs',
    used: (f: OperatorFacts) => f.weedsPlants > 0n || f.weedsTicks > 0n,
  },
  {
    id: 6,
    label: SUBSYSTEM_LABELS[6],
    group: 'labs',
    used: (f: OperatorFacts) => f.forksPainted > 0n || f.lastForkBlock > 0n,
  },
  { id: 7, label: SUBSYSTEM_LABELS[7], group: 'labs', used: (f: OperatorFacts) => f.dnaCatches > 0n },
  { id: 8, label: SUBSYSTEM_LABELS[8], group: 'labs', used: (f: OperatorFacts) => f.bidsPlaced > 0n },
  { id: 9, label: SUBSYSTEM_LABELS[9], group: 'labs', used: (f: OperatorFacts) => f.dreamingDays > 0n },
  { id: 10, label: SUBSYSTEM_LABELS[10], group: 'labs', used: (f: OperatorFacts) => f.recycled > 0n },
  {
    id: 11,
    label: SUBSYSTEM_LABELS[11],
    group: 'hardware',
    used: (f: OperatorFacts) => f.lastCaptureBlock > 0n,
  },
  {
    id: 12,
    label: SUBSYSTEM_LABELS[12],
    group: 'hardware',
    used: (f: OperatorFacts) => f.kernelRuns > 0n,
  },
  { id: 13, label: SUBSYSTEM_LABELS[13], group: 'hardware', used: (f: OperatorFacts) => f.pageNonEmpty },
  {
    id: 14,
    label: SUBSYSTEM_LABELS[14],
    group: 'hardware',
    used: (f: OperatorFacts) => f.cardFound && f.cardFormatted,
  },
  {
    id: 15,
    label: SUBSYSTEM_LABELS[15],
    group: 'identity',
    used: (f: OperatorFacts) => f.monadCardBalance > 0n,
  },
] as const satisfies readonly {
  id: number
  label: string
  group: SubsystemGroup
  used: (facts: OperatorFacts) => boolean
}[]

function normalizeFacts(value: any): OperatorFacts {
  const names = [
    'activeDays',
    'daysPainted',
    'totalPixels',
    'framesMinted',
    'firstPaintBlock',
    'lastPaintBlock',
    'passClaimed',
    'questsCompleted',
    'flipbookFrames',
    'flipbookLastBlock',
    'weedsPlants',
    'weedsTicks',
    'weedsLastBlock',
    'forksPainted',
    'lastForkBlock',
    'dnaCatches',
    'dnaVerified',
    'dnaLastBlock',
    'bidsPlaced',
    'auctionsWon',
    'dreamingDays',
    'recycled',
    'lastRecycleBlock',
    'lastCaptureBlock',
    'kernelRuns',
    'lastKernelBlock',
    'pageNonEmpty',
    'cardFound',
    'cardId',
    'cardFormatted',
    'cardWrites',
    'cardFirstWriteBlock',
    'cardLastWriteBlock',
    'monadCardBalance',
    'answeredMask',
  ] as const
  const raw = (name: (typeof names)[number], index: number) => value?.[name] ?? value?.[index]
  return {
    activeDays: BigInt(raw('activeDays', 0) ?? 0),
    daysPainted: BigInt(raw('daysPainted', 1) ?? 0),
    totalPixels: BigInt(raw('totalPixels', 2) ?? 0),
    framesMinted: BigInt(raw('framesMinted', 3) ?? 0),
    firstPaintBlock: BigInt(raw('firstPaintBlock', 4) ?? 0),
    lastPaintBlock: BigInt(raw('lastPaintBlock', 5) ?? 0),
    passClaimed: Boolean(raw('passClaimed', 6)),
    questsCompleted: BigInt(raw('questsCompleted', 7) ?? 0),
    flipbookFrames: BigInt(raw('flipbookFrames', 8) ?? 0),
    flipbookLastBlock: BigInt(raw('flipbookLastBlock', 9) ?? 0),
    weedsPlants: BigInt(raw('weedsPlants', 10) ?? 0),
    weedsTicks: BigInt(raw('weedsTicks', 11) ?? 0),
    weedsLastBlock: BigInt(raw('weedsLastBlock', 12) ?? 0),
    forksPainted: BigInt(raw('forksPainted', 13) ?? 0),
    lastForkBlock: BigInt(raw('lastForkBlock', 14) ?? 0),
    dnaCatches: BigInt(raw('dnaCatches', 15) ?? 0),
    dnaVerified: BigInt(raw('dnaVerified', 16) ?? 0),
    dnaLastBlock: BigInt(raw('dnaLastBlock', 17) ?? 0),
    bidsPlaced: BigInt(raw('bidsPlaced', 18) ?? 0),
    auctionsWon: BigInt(raw('auctionsWon', 19) ?? 0),
    dreamingDays: BigInt(raw('dreamingDays', 20) ?? 0),
    recycled: BigInt(raw('recycled', 21) ?? 0),
    lastRecycleBlock: BigInt(raw('lastRecycleBlock', 22) ?? 0),
    lastCaptureBlock: BigInt(raw('lastCaptureBlock', 23) ?? 0),
    kernelRuns: BigInt(raw('kernelRuns', 24) ?? 0),
    lastKernelBlock: BigInt(raw('lastKernelBlock', 25) ?? 0),
    pageNonEmpty: Boolean(raw('pageNonEmpty', 26)),
    cardFound: Boolean(raw('cardFound', 27)),
    cardId: BigInt(raw('cardId', 28) ?? 0),
    cardFormatted: Boolean(raw('cardFormatted', 29)),
    cardWrites: BigInt(raw('cardWrites', 30) ?? 0),
    cardFirstWriteBlock: BigInt(raw('cardFirstWriteBlock', 31) ?? 0),
    cardLastWriteBlock: BigInt(raw('cardLastWriteBlock', 32) ?? 0),
    monadCardBalance: BigInt(raw('monadCardBalance', 33) ?? 0),
    answeredMask: BigInt(raw('answeredMask', 34) ?? 0),
  }
}

function normalizeRecord(value: any, firstSeenBlock: bigint): OperatorRecordData {
  const firstObservedRaw = value?.firstObserved ?? value?.[4] ?? []
  return {
    firstRecordBlock: BigInt(value?.firstRecordBlock ?? value?.[0] ?? 0),
    lastRecordBlock: BigInt(value?.lastRecordBlock ?? value?.[1] ?? 0),
    observedMask: BigInt(value?.observedMask ?? value?.[2] ?? 0),
    seasonsObserved: BigInt(value?.seasonsObserved ?? value?.[3] ?? 0),
    firstObserved: Array.from(firstObservedRaw as readonly unknown[], (entry) => BigInt(entry as any)),
    firstSeenBlock,
  }
}

/** Drops subsystems whose only interface was a retired program (src/os/retired.ts) before counting. */
export function visibleSubsystemMask(mask: bigint) {
  let out = mask
  for (const id of RETIRED_SUBSYSTEMS) out &= ~(1n << BigInt(id))
  return out
}

/** Subsystems shown in the app: every Operator Record v1 subsystem except the retired ones. */
export const visibleSubsystems = () => SUBSYSTEMS.filter((subsystem) => !RETIRED_SUBSYSTEMS.has(subsystem.id))

export function subsystemCount(mask: bigint) {
  let value = mask & ~(1n << 15n)
  let count = 0
  while (value) {
    count += Number(value & 1n)
    value >>= 1n
  }
  return count
}

export function lastActive(facts: OperatorFacts) {
  const values = [
    facts.lastPaintBlock,
    facts.flipbookLastBlock,
    facts.weedsLastBlock,
    facts.lastForkBlock,
    facts.dnaLastBlock,
    facts.lastRecycleBlock,
    facts.lastCaptureBlock,
    facts.lastKernelBlock,
    facts.cardLastWriteBlock,
  ]
  return values.reduce((max, value) => (value > max ? value : max), 0n)
}

export function firstSeen(facts: OperatorFacts, record: OperatorRecordData) {
  const values = [
    facts.firstPaintBlock,
    facts.cardFormatted ? facts.cardFirstWriteBlock : 0n,
    // MONAD CARD (id 15) is identity, not r3OS use: it never sets "first seen".
    ...record.firstObserved.filter((_, id) => id !== 15),
  ].filter((value) => value > 0n)
  return values.length ? values.reduce((min, value) => (value < min ? value : min)) : 0n
}

export function seasonOf(timestamp: bigint, start: bigint) {
  if (timestamp < start) return 0n
  return (timestamp - start) / (30n * 24n * 60n * 60n)
}

export function seasonsFromMask(mask: bigint) {
  const seasons: number[] = []
  for (let season = 0; season < 256; season++)
    if ((mask & (1n << BigInt(season))) !== 0n) seasons.push(season)
  return seasons
}

export function dotted(label: string, value: string, width = 44) {
  return `${label} ${'.'.repeat(Math.max(1, width - label.length - value.length - 2))} ${value}`
}

function sourceFor(facts: OperatorFacts, id: number): OperatorSource {
  return bit(facts.answeredMask, id) ? 'ONCHAIN' : 'UNKNOWN'
}

function answered(facts: OperatorFacts, ids: readonly number[]) {
  return ids.every((id) => bit(facts.answeredMask, id))
}

function onchainValue(facts: OperatorFacts, id: number, value: ReactNode): ReactNode {
  return sourceFor(facts, id) === 'ONCHAIN' ? value : OPERATOR_COPY.unknown
}

export function recordRows(
  facts: OperatorFacts,
  record: OperatorRecordData,
  event?: SystemEventSnapshot,
): OperatorRow[] {
  const liveMask = SUBSYSTEMS.reduce(
    (mask, subsystem) => (subsystem.used(facts) ? mask | (1n << BigInt(subsystem.id)) : mask),
    0n,
  )
  const observedSeasons = seasonsFromMask(record.seasonsObserved)
  const lastActiveAnswered = answered(facts, [0, 4, 5, 6, 7, 10, 11, 12, 14])
  const usageAnswered = answered(
    facts,
    Array.from({ length: 15 }, (_, id) => id),
  )
  const latest = lastActive(facts)
  const eventValue = event?.loading
    ? OPERATOR_COPY.unknown
    : !event?.address
      ? OPERATOR_COPY.systemDriverMissing
      : eventState(event) === 'activated'
        ? `${OPERATOR_COPY.systemActivated} · ${OPERATOR_COPY.block} ${event.activatedBlock}`
        : eventState(event) === 'condition-met'
          ? OPERATOR_COPY.systemConditionMet
          : OPERATOR_COPY.systemWaiting

  return [
    {
      label: OPERATOR_COPY.rows.firstSeen,
      value: record.firstSeenBlock
        ? `${OPERATOR_COPY.block} ${record.firstSeenBlock}`
        : OPERATOR_COPY.unknown,
      source: record.firstSeenBlock ? 'DERIVED' : 'UNKNOWN',
    },
    {
      label: OPERATOR_COPY.rows.lastActive,
      value: lastActiveAnswered && latest ? `${OPERATOR_COPY.block} ${latest}` : OPERATOR_COPY.unknown,
      source: lastActiveAnswered && latest ? 'DERIVED' : 'UNKNOWN',
    },
    {
      label: OPERATOR_COPY.rows.firstPaint,
      value: facts.firstPaintBlock
        ? `${OPERATOR_COPY.block} ${facts.firstPaintBlock}`
        : sourceFor(facts, 0) === 'ONCHAIN'
          ? OPERATOR_COPY.notUsed
          : OPERATOR_COPY.unknown,
      source: sourceFor(facts, 0),
    },
    {
      label: OPERATOR_COPY.rows.paintSeasons,
      value:
        record.firstPaintSeason == null || record.lastPaintSeason == null
          ? OPERATOR_COPY.unknown
          : // seasons are 0-based onchain and shown 1-based everywhere else in the app
            `${OPERATOR_COPY.seasonPrefix}${record.firstPaintSeason + 1n} → ${OPERATOR_COPY.seasonPrefix}${record.lastPaintSeason + 1n}`,
      source: record.firstPaintSeason == null || record.lastPaintSeason == null ? 'UNKNOWN' : 'DERIVED',
    },
    {
      label: OPERATOR_COPY.rows.seasonsObserved,
      value: observedSeasons.length
        ? observedSeasons.map((value) => `${OPERATOR_COPY.seasonPrefix}${value + 1}`).join(', ')
        : OPERATOR_COPY.none,
      source: 'ONCHAIN',
    },
    {
      label: OPERATOR_COPY.rows.activeDays,
      value: onchainValue(facts, 0, facts.activeDays.toLocaleString()),
      source: sourceFor(facts, 0),
    },
    {
      label: OPERATOR_COPY.rows.pixelsPainted,
      value: onchainValue(facts, 0, facts.totalPixels.toLocaleString()),
      source: sourceFor(facts, 0),
    },
    {
      label: OPERATOR_COPY.rows.framesSaved,
      value: onchainValue(facts, 1, facts.framesMinted.toLocaleString()),
      source: sourceFor(facts, 1),
    },
    {
      label: OPERATOR_COPY.rows.questsCompleted,
      value: onchainValue(facts, 3, facts.questsCompleted.toLocaleString()),
      source: sourceFor(facts, 3),
    },
    {
      label: OPERATOR_COPY.rows.subsystemsUsed,
      value: usageAnswered
        ? subsystemCount(visibleSubsystemMask(liveMask)).toString()
        : OPERATOR_COPY.unknown,
      source: usageAnswered ? 'DERIVED' : 'UNKNOWN',
    },
    {
      label: SUBSYSTEM_LABELS[15],
      value:
        sourceFor(facts, 15) === 'UNKNOWN'
          ? OPERATOR_COPY.unknown
          : facts.monadCardBalance > 0n
            ? OPERATOR_COPY.present
            : OPERATOR_COPY.notUsed,
      source: sourceFor(facts, 15),
    },
    {
      label: SUBSYSTEM_LABELS[11],
      value:
        sourceFor(facts, 11) === 'UNKNOWN'
          ? OPERATOR_COPY.unknown
          : facts.lastCaptureBlock
            ? `${OPERATOR_COPY.used.toUpperCase()} · ${OPERATOR_COPY.last} ${facts.lastCaptureBlock}`
            : OPERATOR_COPY.notUsed,
      source: sourceFor(facts, 11),
    },
    {
      label: OPERATOR_COPY.rows.recorded,
      value:
        record.firstRecordBlock > 0n
          ? `${OPERATOR_COPY.first} ${record.firstRecordBlock} · ${OPERATOR_COPY.lastWord} ${record.lastRecordBlock}`
          : OPERATOR_COPY.notRecorded,
      source: 'ONCHAIN',
    },
    {
      label: OPERATOR_COPY.rows.systemEvent,
      value: eventValue,
      source: event?.loading ? 'UNKNOWN' : event?.address ? 'ONCHAIN' : 'UNKNOWN',
    },
  ]
}

const blockTimestampCache = new Map<string, Promise<bigint | undefined>>()

function blockTimestamp(blockNumber: bigint) {
  const key = blockNumber.toString()
  let cached = blockTimestampCache.get(key)
  if (!cached) {
    cached = publicClient
      ? publicClient
          .getBlock({ blockNumber })
          .then((block) => BigInt(block.timestamp))
          .catch(() => undefined)
      : Promise.resolve(undefined)
    blockTimestampCache.set(key, cached)
  }
  return cached
}

async function readOperator(address: Address): Promise<OperatorSnapshot> {
  const contracts = await discoverContracts()
  const driverAddress = contracts.labs['operator-record']
  if (!driverAddress) return { loading: false, status: 'no-driver', address }

  const [factRows, recordRowsResult] = await Promise.all([
    readHeavy([
      {
        address: driverAddress,
        abi: R3OS_OPERATOR_RECORD_ABI,
        functionName: 'facts',
        args: [address],
      },
    ]),
    readMany(
      [
        {
          address: driverAddress,
          abi: R3OS_OPERATOR_RECORD_ABI,
          functionName: 'recordOf',
          args: [address],
        },
        {
          address: driverAddress,
          abi: R3OS_OPERATOR_RECORD_ABI,
          functionName: 'firstSeenBlock',
          args: [address],
        },
      ],
      { allowFailure: true },
    ),
  ])

  if (factRows[0]?.status !== 'success') throw factRows[0]?.error ?? new Error('OPERATOR_FACTS_UNAVAILABLE')
  const recordRow = recordRowsResult[0] as any
  const firstSeenRow = recordRowsResult[1] as any
  if (recordRow?.status !== 'success') throw recordRow?.error ?? new Error('OPERATOR_RECORD_UNAVAILABLE')

  const facts = normalizeFacts(factRows[0].result)
  const record = normalizeRecord(
    recordRow.result,
    firstSeenRow?.status === 'success' ? BigInt(firstSeenRow.result) : 0n,
  )

  if (facts.firstPaintBlock > 0n || facts.lastPaintBlock > 0n) {
    const [constants, firstTimestamp, lastTimestamp] = await Promise.all([
      readCoreConstants(),
      facts.firstPaintBlock > 0n ? blockTimestamp(facts.firstPaintBlock) : Promise.resolve(undefined),
      facts.lastPaintBlock > 0n ? blockTimestamp(facts.lastPaintBlock) : Promise.resolve(undefined),
    ])
    if (firstTimestamp != null) record.firstPaintSeason = seasonOf(firstTimestamp, constants.SEASON_START)
    if (lastTimestamp != null) record.lastPaintSeason = seasonOf(lastTimestamp, constants.SEASON_START)
  }

  return { loading: false, status: 'ready', address, driverAddress, facts, record }
}

let sharedRead: { key: string; promise: Promise<OperatorSnapshot> } | undefined
let lastSnapshot: { address: Address; value: OperatorSnapshot } | undefined

function readShared(address: Address, tick: number) {
  const key = `${address.toLowerCase()}:${tick}`
  if (sharedRead?.key === key) return sharedRead.promise
  const promise = readOperator(address).then((value) => {
    lastSnapshot = { address, value }
    return value
  })
  sharedRead = { key, promise }
  promise.catch(() => {
    if (sharedRead?.promise === promise) sharedRead = undefined
  })
  return promise
}

export function useOperatorRecord(address?: Address) {
  const tick = useRefreshTick(100)
  const [snapshot, setSnapshot] = useState<OperatorSnapshot>(() =>
    address && lastSnapshot?.address.toLowerCase() === address.toLowerCase() ? lastSnapshot.value : EMPTY,
  )

  useEffect(() => {
    if (!address) {
      setSnapshot({ loading: false, status: 'no-address' })
      return
    }
    let cancelled = false
    readShared(address, tick)
      .then((value) => {
        if (!cancelled) setSnapshot(value)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [address, tick])

  return snapshot
}

export function __resetOperatorRecordForTests() {
  sharedRead = undefined
  lastSnapshot = undefined
  blockTimestampCache.clear()
}
