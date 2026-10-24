import { describe, expect, it } from 'vitest'
import { programById, programs, visiblePrograms } from './programs'
import { RETIRED_EXPERIMENTS, RETIRED_PROGRAMS, questIsRetired, retiredAddresses } from './retired'

const snapshot = { status: 'ready', config: { programs: {} }, revealAll: true } as const

describe('retired programs', () => {
  it('keeps retired UI code out of the program registry entirely', () => {
    for (const id of RETIRED_PROGRAMS) expect(programById(id), id).toBeUndefined()
    const visible = visiblePrograms(snapshot as never).map((program) => program.id)
    for (const id of RETIRED_PROGRAMS) expect(visible, id).not.toContain(id)
  })

  it('keeps the programs dreiki chose', () => {
    const visible = visiblePrograms(snapshot as never).map((program) => program.id)
    for (const id of [
      'paint',
      'pass',
      'frames',
      'cd',
      'cdrom',
      'replay',
      'storms',
      'status',
      'block-camera',
      'auction',
      'quests',
      'validators',
      'monad-hw',
      'dxdiag',
      'xray',
      'sounds',
      'help',
      'bin',
    ]) {
      expect(visible, id).toContain(id)
    }
    expect(visible.length).toBe(18)
    expect(programs.length).toBeGreaterThan(visible.length)
  })

  it('maps registry names to addresses, keeping CARD.DRV', () => {
    const labs = {
      flipbook: '0xAAA',
      weeds: '0xBBB',
      'card-drv': '0xCCC',
      'cd-burner': '0xDDD',
      'router-lab': '0xEEE',
    }
    const retired = retiredAddresses(labs)
    expect([...retired].sort()).toEqual(['0xaaa', '0xbbb', '0xeee'])
    expect(RETIRED_EXPERIMENTS.has('card-drv')).toBe(false)
  })

  it('hides a quest when any condition reads a retired Lab', () => {
    const retired = new Set(['0xaaa'])
    expect(questIsRetired([{ target: '0xAAA' }], retired)).toBe(true)
    expect(questIsRetired([{ target: '0xccc' }, { target: '0xAaA' }], retired)).toBe(true)
    expect(questIsRetired([{ target: '0xccc' }], retired)).toBe(false)
    expect(questIsRetired([], retired)).toBe(false)
  })
})
