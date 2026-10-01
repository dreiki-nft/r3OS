import { useEffect, useState } from 'react'
import { parseAbi, type Address } from 'viem'
import { R3TARDS_SYSTEM_EVENT_ABI } from '../lib/generated/abi'
import { discoverContracts } from './contracts'
import { readMany } from './readMany'
import { useRefreshTick } from './refreshTick'

const FEED_ABI = parseAbi(['function description() view returns (string)'])

export type SystemEventState = 'no-driver' | 'armed' | 'condition-met' | 'activated'

export interface SystemEventSnapshot {
  loading: boolean
  address?: Address
  trigger?: string
  feed?: Address
  feedDecimals?: number
  thresholdMilliUsd?: bigint
  maxAge?: bigint
  feedDescription?: string
  activatedBlock: bigint
  activationAnswer: bigint
  condition: {
    met: boolean
    fresh: boolean
    answer: bigint
    updatedAt: bigint
    roundId: bigint
  }
}

const EMPTY: SystemEventSnapshot = {
  loading: true,
  activatedBlock: 0n,
  activationAnswer: 0n,
  condition: { met: false, fresh: false, answer: 0n, updatedAt: 0n, roundId: 0n },
}

export function eventState(snapshot: Pick<SystemEventSnapshot, 'address' | 'activatedBlock' | 'condition'>) {
  if (!snapshot.address) return 'no-driver' as const
  if (snapshot.activatedBlock > 0n) return 'activated' as const
  if (snapshot.condition.met) return 'condition-met' as const
  return 'armed' as const
}

export function formatUsd(answer: bigint, decimals: number) {
  const negative = answer < 0n
  const value = negative ? -answer : answer
  const scale = 10n ** BigInt(decimals)
  const whole = value / scale
  const fraction = value % scale
  const four =
    decimals >= 4
      ? (fraction / 10n ** BigInt(decimals - 4)).toString().padStart(4, '0')
      : (fraction * 10n ** BigInt(4 - decimals)).toString().padStart(4, '0')
  return `${negative ? '-' : ''}$${whole.toString()}.${four}`
}

function normalizeCondition(value: unknown): SystemEventSnapshot['condition'] {
  const row = value as any
  return {
    met: Boolean(row?.met ?? row?.[0]),
    fresh: Boolean(row?.fresh ?? row?.[1]),
    answer: BigInt(row?.answer ?? row?.[2] ?? 0),
    updatedAt: BigInt(row?.updatedAt ?? row?.[3] ?? 0),
    roundId: BigInt(row?.roundId ?? row?.[4] ?? 0),
  }
}

type StaticEvent = Pick<
  SystemEventSnapshot,
  'address' | 'trigger' | 'feed' | 'feedDecimals' | 'thresholdMilliUsd' | 'maxAge' | 'feedDescription'
>

let staticEvent: Promise<StaticEvent | undefined> | undefined

async function readStaticEvent() {
  if (staticEvent) return staticEvent
  staticEvent = (async () => {
    const contracts = await discoverContracts()
    const address = contracts.labs['system-event']
    if (!address) return undefined

    const rows = await readMany(
      [
        { address, abi: R3TARDS_SYSTEM_EVENT_ABI, functionName: 'TRIGGER' },
        { address, abi: R3TARDS_SYSTEM_EVENT_ABI, functionName: 'FEED' },
        { address, abi: R3TARDS_SYSTEM_EVENT_ABI, functionName: 'FEED_DECIMALS' },
        { address, abi: R3TARDS_SYSTEM_EVENT_ABI, functionName: 'THRESHOLD_MILLI_USD' },
        { address, abi: R3TARDS_SYSTEM_EVENT_ABI, functionName: 'MAX_AGE' },
      ],
      { allowFailure: true },
    )
    const success = (index: number) => (rows[index] as any)?.status === 'success'
    if (!success(0) || !success(1) || !success(2) || !success(3) || !success(4)) {
      throw new Error('SYSTEM_EVENT_STATIC_UNAVAILABLE')
    }

    const feed = (rows[1] as any).result as Address
    const descriptionRows = await readMany(
      [{ address: feed, abi: FEED_ABI, functionName: 'description' }],
      { allowFailure: true },
    ).catch(() => [])
    const description =
      (descriptionRows[0] as any)?.status === 'success'
        ? String((descriptionRows[0] as any).result)
        : undefined

    return {
      address,
      trigger: String((rows[0] as any).result),
      feed,
      feedDecimals: Number((rows[2] as any).result),
      thresholdMilliUsd: BigInt((rows[3] as any).result),
      maxAge: BigInt((rows[4] as any).result),
      feedDescription: description,
    }
  })().catch((error) => {
    staticEvent = undefined
    throw error
  })
  return staticEvent
}

export async function readSystemEventNow(): Promise<SystemEventSnapshot> {
  const staticValues = await readStaticEvent()
  if (!staticValues?.address) return { ...EMPTY, loading: false }

  const rows = await readMany(
    [
      {
        address: staticValues.address,
        abi: R3TARDS_SYSTEM_EVENT_ABI,
        functionName: 'activatedBlock',
      },
      {
        address: staticValues.address,
        abi: R3TARDS_SYSTEM_EVENT_ABI,
        functionName: 'activationAnswer',
      },
      {
        address: staticValues.address,
        abi: R3TARDS_SYSTEM_EVENT_ABI,
        functionName: 'condition',
      },
    ],
    { allowFailure: true },
  )

  if (
    (rows[0] as any)?.status !== 'success' ||
    (rows[1] as any)?.status !== 'success' ||
    (rows[2] as any)?.status !== 'success'
  ) {
    throw new Error('SYSTEM_EVENT_DYNAMIC_UNAVAILABLE')
  }
  const activatedBlock = BigInt((rows[0] as any).result)
  const activationAnswer = BigInt((rows[1] as any).result)
  const condition = normalizeCondition((rows[2] as any).result)

  return {
    loading: false,
    ...staticValues,
    activatedBlock,
    activationAnswer,
    condition,
  }
}

let sharedRead: { tick: number; promise: Promise<SystemEventSnapshot> } | undefined
let lastSnapshot: SystemEventSnapshot | undefined

function readShared(tick: number) {
  if (sharedRead?.tick === tick) return sharedRead.promise
  const promise = readSystemEventNow().then((value) => {
    lastSnapshot = value
    return value
  })
  sharedRead = { tick, promise }
  promise.catch(() => {
    if (sharedRead?.promise === promise) sharedRead = undefined
  })
  return promise
}

export function useSystemEvent() {
  const tick = useRefreshTick(100)
  const [snapshot, setSnapshot] = useState<SystemEventSnapshot>(() => lastSnapshot ?? EMPTY)

  useEffect(() => {
    let cancelled = false
    readShared(tick)
      .then((value) => {
        if (!cancelled) setSnapshot(value)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [tick])

  return snapshot
}

export function __resetSystemEventForTests() {
  staticEvent = undefined
  sharedRead = undefined
  lastSnapshot = undefined
}
