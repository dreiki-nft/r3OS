import { parseAbi, type Address } from 'viem'
import { publicClient } from '../chain/clients'
import { readMany, type ReadManyResult } from '../chain/readMany'
import { R3TARDS_PAINTER_PASS_ABI } from '../lib/generated/abi'

export const STAMP_ABI = parseAbi(['function stamp(address painter) view returns (string name,bool earned)'])

export interface StampRow {
  name: string
  earned: boolean
  source?: Address
  rule: string
}

const rules: Record<string, string> = {
  FLIPBOOK: '10 distinct Flipbook frames',
  GARDENER: '5 plants or 25 ticks',
  FORKER: '3 distinct forks painted',
  'BLOCK DNA': '3 verifications',
  'MONAD CARD': 'hold a Monad Card',
}

export async function loadLabStamps(pass: Address, owner: Address) {
  if (!publicClient) return []
  const client = publicClient
  const count = (await client.readContract({
    address: pass,
    abi: R3TARDS_PAINTER_PASS_ABI,
    functionName: 'stampSourceCount',
  })) as bigint
  const sources = (await readMany(
    Array.from({ length: Number(count) }, (_, index) => ({
      address: pass,
      abi: R3TARDS_PAINTER_PASS_ABI,
      functionName: 'stampSource',
      args: [BigInt(index)],
    })),
    { allowFailure: false },
  )) as Address[]

  const stampRows = (await readMany(
    sources.map((source) => ({
      address: source,
      abi: STAMP_ABI,
      functionName: 'stamp',
      args: [owner],
    })),
    { allowFailure: true },
  )) as ReadManyResult[]

  return sources.map((source, index): StampRow => {
    const row = stampRows[index]
    if (row?.status !== 'success')
      return { name: `Lab ${index}`, earned: false, source, rule: 'stamp source unavailable' }
    const [name, earned] = row.result as readonly [string, boolean]
    return {
      name,
      earned,
      source,
      rule: name.startsWith('QUESTS ') ? 'n quests claimed' : (rules[name] ?? 'Lab-specific rule'),
    }
  })
}

export const builtInStamps = (stats: {
  firstPaintBlock: bigint
  framesMinted: bigint
  sessionPaints: bigint
  stormPaints: bigint
  activeDays: bigint
  holder: boolean
}): StampRow[] => [
  { name: 'FIRST PAINT', earned: stats.firstPaintBlock > 0n, rule: 'paint once' },
  { name: 'FIRST FRAME', earned: stats.framesMinted > 0n, rule: 'mint a frame' },
  { name: 'LIVE PAINTER', earned: stats.sessionPaints >= 10n, rule: '10 session-key paints' },
  { name: 'STORM CHASER', earned: stats.stormPaints >= 1n, rule: 'paint during a storm' },
  { name: 'REGULAR', earned: stats.activeDays >= 7n, rule: '7 active days' },
  { name: 'HOLDER', earned: stats.holder, rule: 'own at least 1 r3tard now' },
]
