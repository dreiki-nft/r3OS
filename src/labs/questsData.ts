import type { Address } from 'viem'
import { readMany } from '../chain/readMany'
import { R3TARDS_QUESTS_ABI } from '../lib/generated/abi'
import { labAddress } from './labCommon'
import { mapQuestProgress, type QuestProgressState } from './quests'

export type QuestCondition = {
  target: Address
  selector: `0x${string}`
  word: number
  op: number
  threshold: bigint
}

export type QuestDefinition = {
  id: number
  name: string
  startBlock: bigint
  endBlock: bigint
  conditions: QuestCondition[]
}

export interface QuestAccountData {
  claimableMask: bigint
  completedMask: bigint
  completedCount: bigint
  progress: QuestProgressState[]
}

type Cached<T> = { value?: T; fetchedAt: number; promise?: Promise<T> }

const FRESH_MS = 8_000
let addressPromise: Promise<Address> | undefined
const definitions = new Map<string, Cached<QuestDefinition[]>>()
const accountData = new Map<string, Cached<QuestAccountData>>()

function normalizeCondition(value: any): QuestCondition {
  return {
    target: (value.target ?? value[0]) as Address,
    selector: (value.selector ?? value[1]) as `0x${string}`,
    word: Number(value.word ?? value[2]),
    op: Number(value.op ?? value[3]),
    threshold: BigInt(value.threshold ?? value[4]),
  }
}

export function questAddress() {
  if (!addressPromise) {
    addressPromise = labAddress('quests').catch((error) => {
      addressPromise = undefined
      throw error
    })
  }
  return addressPromise
}

export async function readQuestDefinitions(address: Address, force = false) {
  const key = address.toLowerCase()
  const existing = definitions.get(key)
  if (!force && existing?.value && Date.now() - existing.fetchedAt < FRESH_MS) {
    return existing.value
  }
  if (existing?.promise) return existing.promise
  const entry: Cached<QuestDefinition[]> = existing ?? { fetchedAt: 0 }
  const pending = (async () => {
    const countRows = await readMany(
      [{ address, abi: R3TARDS_QUESTS_ABI, functionName: 'questCount' }],
      { allowFailure: false },
    )
    const count = Number(countRows[0] as bigint)
    if (!count) return []
    const values = await readMany(
      Array.from({ length: count }, (_, id) => ({
        address,
        abi: R3TARDS_QUESTS_ABI,
        functionName: 'questInfo',
        args: [BigInt(id)],
      })),
      { allowFailure: false },
    )
    return values.map((value: any, id): QuestDefinition => ({
      id,
      name: String(value[0]),
      startBlock: BigInt(value[1]),
      endBlock: BigInt(value[2]),
      conditions: (value[3] as any[]).map(normalizeCondition),
    }))
  })()
    .then((value) => {
      entry.value = value
      entry.fetchedAt = Date.now()
      return value
    })
    .finally(() => {
      if (entry.promise === pending) entry.promise = undefined
    })
  entry.promise = pending
  definitions.set(key, entry)
  return pending
}

export async function readQuestAccountData(
  address: Address,
  owner: Address,
  defs: readonly QuestDefinition[],
  force = false,
) {
  const key = `${address.toLowerCase()}:${owner.toLowerCase()}:${defs.length}`
  const existing = accountData.get(key)
  if (!force && existing?.value && Date.now() - existing.fetchedAt < FRESH_MS) return existing.value
  if (existing?.promise) return existing.promise
  const entry: Cached<QuestAccountData> = existing ?? { fetchedAt: 0 }
  const pending = (async (): Promise<QuestAccountData> => {
    if (!defs.length) {
      return { claimableMask: 0n, completedMask: 0n, completedCount: 0n, progress: [] }
    }
    const rows = await readMany(
      [
        { address, abi: R3TARDS_QUESTS_ABI, functionName: 'claimable', args: [owner] },
        { address, abi: R3TARDS_QUESTS_ABI, functionName: 'completedMask', args: [owner] },
        { address, abi: R3TARDS_QUESTS_ABI, functionName: 'completedCount', args: [owner] },
        ...defs.map((quest) => ({
          address,
          abi: R3TARDS_QUESTS_ABI,
          functionName: 'progress',
          args: [owner, BigInt(quest.id)],
        })),
      ],
      { allowFailure: false },
    )
    const claimableMask = BigInt(rows[0] as bigint)
    const completedMask = BigInt(rows[1] as bigint)
    const completedCount = BigInt(rows[2] as bigint)
    return {
      claimableMask,
      completedMask,
      completedCount,
      progress: defs.map((quest, index) => {
        const row = rows[index + 3] as any
        const values = (row[0] as readonly bigint[]).map(BigInt)
        const passing = (row[1] as readonly boolean[]).map(Boolean)
        const bit = 1n << BigInt(quest.id)
        return mapQuestProgress(
          quest.conditions,
          values,
          passing,
          Boolean(completedMask & bit),
          Boolean(claimableMask & bit),
        )
      }),
    }
  })()
    .then((value) => {
      entry.value = value
      entry.fetchedAt = Date.now()
      return value
    })
    .finally(() => {
      if (entry.promise === pending) entry.promise = undefined
    })
  entry.promise = pending
  accountData.set(key, entry)
  return pending
}

export async function prefetchQuestData(owner?: Address) {
  const address = await questAddress()
  const defs = await readQuestDefinitions(address)
  if (owner) await readQuestAccountData(address, owner, defs)
  return { address, defs }
}

export function invalidateQuestAccount(owner?: Address) {
  if (!owner) {
    accountData.clear()
    return
  }
  const suffix = `:${owner.toLowerCase()}:`
  for (const key of accountData.keys()) if (key.includes(suffix)) accountData.delete(key)
}

export function __resetQuestDataForTests() {
  addressPromise = undefined
  definitions.clear()
  accountData.clear()
}
