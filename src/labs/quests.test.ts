import { describe, expect, it } from 'vitest'
import { mapQuestProgress } from './quests'
import { badgeSrc } from './QuestsProgram'

describe('quest progress mapping', () => {
  it('maps all 13 quest ids to badges including RECYCLER', () => {
    expect(Array.from({ length: 13 }, (_, id) => badgeSrc(id))).toHaveLength(13)
    expect(badgeSrc(12)).toBe('/os/badges/q12_recycler.png')
  })
  it('maps a single-condition quest', () => {
    expect(mapQuestProgress([{ threshold: 30n, op: 0 }], [23n], [false], false, false)).toMatchObject({
      value: 23n,
      goal: 30n,
      label: '23 / 30',
      complete: false,
      claimable: false,
      claimed: false,
    })
  })

  it('maps multi-condition quests as conditions passed', () => {
    expect(
      mapQuestProgress(
        Array.from({ length: 4 }, () => ({ threshold: 1n, op: 0 })),
        [1n, 0n, 1n, 0n],
        [true, false, true, false],
        false,
        false,
      ),
    ).toMatchObject({ value: 2n, goal: 4n, label: '2 / 4 conditions', complete: false })
  })
  it('preserves claimable and claimed states from fake reads', () => {
    expect(mapQuestProgress([{ threshold: 10n, op: 0 }], [10n], [true], false, true)).toMatchObject({
      value: 10n,
      goal: 10n,
      complete: true,
      claimable: true,
      claimed: false,
    })
    expect(mapQuestProgress([{ threshold: 10n, op: 0 }], [12n], [true], true, false)).toMatchObject({
      complete: true,
      claimable: false,
      claimed: true,
    })
  })
})
