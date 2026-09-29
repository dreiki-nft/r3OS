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
