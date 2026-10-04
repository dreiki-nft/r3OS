import { describe, expect, it } from 'vitest'
import { auctionIsLive } from '../labs/auctionLive'
import { DESKTOP_PROGRAMS, START_PROGRAMS, SYSTEM_TOOLS, desktopProgramIds, startMenuGroups } from './layout'
import { programById, programIsVisible, visiblePrograms } from './programs'
import { RETIRED_PROGRAMS } from './retired'
import { RUN_COMMANDS, parseRunCommand } from './run'

const snapshot = { status: 'ready', config: { programs: {} }, revealAll: true } as const
const visible = (id: string) => {
  const program = programById(id)
  return Boolean(program && programIsVisible(program, snapshot as never))
}

describe('desktop', () => {
  it('shows a small set of primary programs, in order', () => {
    expect(desktopProgramIds(visible, false)).toEqual([
      'paint',
      'monad-hw',
      'frames',
      'pass',
      'block-camera',
      'cdrom',
      'quests',
      'bin',
    ])
  })

  it('adds Auction after the primary desktop order only while an auction is live', () => {
    const ids = desktopProgramIds(visible, true)
    expect(ids).toHaveLength(9)
    expect(ids.at(-1)).toBe('auction')
    expect(auctionIsLive(0n, undefined)).toBe(false)
    expect(auctionIsLive(2n, 1)).toBe(true)
    expect(auctionIsLive(2n, 2)).toBe(false)
    expect(auctionIsLive(2n, 3)).toBe(false)
  })

  it('keeps support tools off the desktop', () => {
    const ids = desktopProgramIds(visible, true)
    for (const id of ['dxdiag', 'xray', 'sounds', 'help', 'validators', 'cd'])
      expect(ids, id).not.toContain(id)
  })

  it('drops programs that are not visible', () => {
    expect(desktopProgramIds((id) => id !== 'quests' && visible(id), false)).not.toContain('quests')
  })
})

describe('Start menu', () => {
  it('groups Programs, Explore Monad and System Tools', () => {
    const groups = startMenuGroups(visible)
    expect(groups.programs).toEqual([...START_PROGRAMS])
    expect(groups.explore).toBe('monad-hw')
    expect(programById('monad-hw')?.title).toBe('Explore Monad')
    expect(groups.tools).toEqual([...SYSTEM_TOOLS])
    expect(groups.help).toBe(true)
  })

  it('reaches every visible program exactly once (or via the desktop shell objects)', () => {
    const groups = startMenuGroups(visible)
    const reachable = [...groups.programs, groups.explore, ...groups.tools, 'help']
    const all = visiblePrograms(snapshot as never).map((program) => program.id)
    for (const id of all) expect(reachable, id).toContain(id)
    expect(new Set(reachable).size).toBe(reachable.length)
  })
})

describe('retired programs stay retired', () => {
  it('never appear on the desktop, in Start, in Run…, or open by deep link', () => {
    const everywhere = [...DESKTOP_PROGRAMS, ...START_PROGRAMS, ...SYSTEM_TOOLS, 'auction']
    for (const id of RETIRED_PROGRAMS) {
      expect(everywhere, id).not.toContain(id)
      expect(visible(id), id).toBe(false)
      expect(Object.values(RUN_COMMANDS), id).not.toContain(id)
    }
    for (const command of ['page', 'router', 'cardmem', 'kernel', 'lanes', 'flipbook'])
      expect(parseRunCommand(command).ok, command).toBe(false)
    expect(parseRunCommand('explore')).toEqual({ ok: true, target: { program: 'monad-hw' } })
  })
})
