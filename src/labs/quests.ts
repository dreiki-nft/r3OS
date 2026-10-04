export interface QuestConditionLike {
  threshold: bigint
  op: number | bigint
}

export interface QuestProgressState {
  values: bigint[]
  passing: boolean[]
  goal: bigint
  value: bigint
  label: string
  complete: boolean
  claimable: boolean
  claimed: boolean
}

export function mapQuestProgress(
  conditions: readonly QuestConditionLike[],
  values: readonly bigint[],
  passing: readonly boolean[],
  claimed: boolean,
  claimable: boolean,
): QuestProgressState {
  const multi = conditions.length > 1
  const completeCount = passing.filter(Boolean).length
  const value = multi ? BigInt(completeCount) : (values[0] ?? 0n)
  const goal = multi ? BigInt(conditions.length) : (conditions[0]?.threshold ?? 0n)
  return {
    values: [...values],
    passing: [...passing],
    value,
    goal,
    label: multi ? `${completeCount} / ${conditions.length} conditions` : `${value} / ${goal}`,
    complete: passing.length === conditions.length && passing.every(Boolean),
    claimable,
    claimed,
  }
}

export interface QuestTargetLike {
  target: string
}

export function questLockedByHiddenLab(
  conditions: readonly QuestTargetLike[],
  targetPrograms: Readonly<Record<string, string>>,
  isHidden: (programId: string) => boolean,
) {
  return conditions.some((condition) => {
    const programId = targetPrograms[condition.target.toLowerCase()]
    return Boolean(programId && isHidden(programId))
  })
}

/**
 * Where to go to work on a quest: a plain "try it" link, by the quest's onchain name. Unknown names get none.
 * Purely navigation; the onchain definitions are unchanged.
 */
export const QUEST_HOW: Readonly<Record<string, { program: string; label: string; hash?: string }>> = {
  'MONTH IN': { program: 'paint', label: 'Open Paint' },
  'STORM REGULAR': { program: 'paint', label: 'Open Paint' },
  '10K PIXELS': { program: 'paint', label: 'Open Paint' },
  ARCHIVIST: { program: 'paint', label: 'Open Paint' },
  'LIVE WIRE': { program: 'live-wizard', label: 'Turn on Live mode' },
  'PADDLE UP': { program: 'auction', label: 'Open Auction' },
  RECYCLER: { program: 'bin', label: 'Open Recycle Bin' },
  'CARD CARRIER': { program: 'paint', label: 'Open Paint' },
}

export type QuestGroup = 'canvas' | 'around'

/** Quests that read the Paint core are "on the canvas"; everything else is "around r3OS". */
export function questGroup(conditions: readonly { target: string }[], paintAddress?: string): QuestGroup {
  if (!paintAddress || !conditions.length) return 'around'
  const paint = paintAddress.toLowerCase()
  return conditions.every((condition) => condition.target.toLowerCase() === paint) ? 'canvas' : 'around'
}

export const QUEST_GROUP_TITLES: Record<QuestGroup, string> = {
  canvas: 'ON THE CANVAS',
  around: 'AROUND r3OS',
}
