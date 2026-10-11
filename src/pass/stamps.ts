import { parseAbi, type Address } from 'viem'
import { publicClient } from '../chain/clients'
import { readMany, type ReadManyResult } from '../chain/readMany'
import { R3OS_PAINTER_PASS_ABI } from '../lib/generated/abi'

export const STAMP_ABI = parseAbi(['function stamp(address painter) view returns (string name,bool earned)'])
const RECYCLE_BIN_ABI = parseAbi(['function burnedBy(address) view returns (uint256)'])
/** RecycleBin.RECYCLER_STAMP_BURNS in the deployed Lab. */
export const RECYCLER_BURNS = 100n

export interface StampRow {
  name: string
  earned: boolean
  source?: Address
  /** how to earn it, in plain words */
  rule: string
  /** where the painter stands, e.g. "4 of 7 days" */
  progress?: string
  /** program that earns it */
  program?: string
  /** group for "View by Lab" */
  lab: string
}

/** How each Lab stamp is earned, keyed by the name its contract returns. */
export function labStampInfo(name: string): Pick<StampRow, 'rule' | 'program' | 'lab'> {
  if (name.startsWith('QUESTS '))
    return { rule: 'claim a quest in Quests.', program: 'quests', lab: 'Quests' }
  if (name === 'RECYCLER')
    return {
      rule: `recycle ${RECYCLER_BURNS} frames in the Recycle Bin.`,
      program: 'bin',
      lab: 'Recycle Bin',
    }
  if (name === 'MONAD CARD') return { rule: 'hold a Monad Card in this wallet.', lab: 'Monad Card' }
  return { rule: 'earned through one of the Labs.', lab: 'Other Labs' }
}

export async function loadLabStamps(pass: Address, owner: Address) {
  if (!publicClient) return []
  const client = publicClient
  const count = (await client.readContract({
    address: pass,
    abi: R3OS_PAINTER_PASS_ABI,
    functionName: 'stampSourceCount',
  })) as bigint
  const sources = (await readMany(
    Array.from({ length: Number(count) }, (_, index) => ({
      address: pass,
      abi: R3OS_PAINTER_PASS_ABI,
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

  const rows = sources.map((source, index): StampRow => {
    const row = stampRows[index]
    if (row?.status !== 'success')
      return {
        name: `Lab ${index}`,
        earned: false,
        source,
        rule: 'this Lab could not be read right now.',
        lab: 'Other Labs',
      }
    const [name, earned] = row.result as readonly [string, boolean]
    const info = labStampInfo(name)
    const count = name.startsWith('QUESTS ') ? name.slice('QUESTS '.length) : undefined
    return { name, earned, source, ...info, ...(count ? { progress: `${count} claimed so far` } : {}) }
  })

  // RECYCLER needs 100 burns, so show how far along the painter is.
  const recycler = rows.find((row) => row.name === 'RECYCLER' && !row.earned && row.source)
  if (recycler?.source) {
    try {
      const burned = (await client.readContract({
        address: recycler.source,
        abi: RECYCLE_BIN_ABI,
        functionName: 'burnedBy',
        args: [owner],
      })) as bigint
      recycler.progress = `${burned} of ${RECYCLER_BURNS} recycled`
    } catch {
      // Progress is a nice-to-have.
    }
  }
  return rows
}

export const builtInStamps = (stats: {
  firstPaintBlock: bigint
  framesMinted: bigint
  sessionPaints: bigint
  stormPaints: bigint
  activeDays: bigint
  holder: boolean
  /** "a storm is on now" / "next storm in 2 h 10 m", from the block clock */
  stormNote?: string
}): StampRow[] => {
  const lab = 'Painter Pass'
  const of = (value: bigint, goal: bigint, unit: string) =>
    `${value > goal ? goal : value} of ${goal} ${unit}`
  return [
    {
      name: 'FIRST PAINT',
      earned: stats.firstPaintBlock > 0n,
      rule: 'paint anything once.',
      program: 'paint',
      lab,
    },
    {
      name: 'FIRST FRAME',
      earned: stats.framesMinted > 0n,
      rule: 'save a frame: in Paint, File › Save frame…',
      program: 'paint',
      lab,
    },
    {
      name: 'LIVE PAINTER',
      earned: stats.sessionPaints >= 10n,
      rule: 'paint 10 times with Live Mode on.',
      progress: of(stats.sessionPaints, 10n, 'Live Mode paints'),
      program: 'paint',
      lab,
    },
    {
      name: 'STORM CHASER',
      earned: stats.stormPaints >= 1n,
      rule: 'paint while a DF1 storm is on.',
      progress: stats.stormNote,
      program: 'paint',
      lab,
    },
    {
      name: 'REGULAR',
      earned: stats.activeDays >= 7n,
      rule: 'paint on 7 different days.',
      progress: of(stats.activeDays, 7n, 'days'),
      program: 'paint',
      lab,
    },
    { name: 'HOLDER', earned: stats.holder, rule: 'hold at least one r3tard in this wallet.', lab },
  ]
}
