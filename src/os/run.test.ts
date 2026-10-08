import { afterEach, describe, expect, it } from 'vitest'
import { RUN_COMMANDS, parseRunCommand } from './run'
import { openProgram, programById } from './programs'
import { __setReleaseSnapshotForTests } from './releases'
import { RETIRED_PROGRAMS, isRetiredProgram } from './retired'

const target = (input: string) => {
  const parsed = parseRunCommand(input)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.target
}
const rejected = (input: string) => !parseRunCommand(input).ok

describe('Run… parser', () => {
  it('maps every command and alias to a real program id', () => {
    for (const [command, id] of Object.entries(RUN_COMMANDS)) {
      expect(programById(id), command).toBeTruthy()
      expect(target(command)).toEqual({ program: id })
    }
    expect(target('camera').program).toBe('block-camera')
    expect(target('hardware').program).toBe('monad-hw')
    expect(target('network').program).toBe('validators')
  })

  it('is case-insensitive, trims spaces and accepts a trailing .exe', () => {
    expect(target('  PAINT  ').program).toBe('paint')
    expect(target('DxDiag.EXE').program).toBe('dxdiag')
    expect(target('bin.exe').program).toBe('bin')
    expect(target('demo.exe')).toEqual({ program: 'demo' })
    expect(target('DEMO')).toEqual({ program: 'demo' })
  })

  it('builds the operator and argument routes itself', () => {
    expect(target('operator')).toEqual({ program: 'pass', hash: '#/pass?tab=Operator' })
    expect(target('frame 12')).toEqual({ program: 'frame-props', hash: '#/frame-props?token=12' })
    expect(target('auction 3')).toEqual({ program: 'auction', hash: '#/auction?auction=3' })
    expect(target('tv')).toEqual({ program: 'paint', hash: '#/tv' })
    expect(target('Broadcast.exe')).toEqual({ program: 'paint', hash: '#/tv' })
    expect(rejected('tv 2')).toBe(true)
  })

  it('rejects bad arguments and bounds', () => {
    expect(rejected('frame -1')).toBe(true)
    expect(rejected('frame 12abc')).toBe(true)
    expect(rejected('frame 1 2')).toBe(true)
    expect(rejected('frame 0')).toBe(true)
    expect(rejected(`frame ${Number.MAX_SAFE_INTEGER + 1}`)).toBe(true)
    expect(rejected('auction 0')).toBe(true)
    expect(rejected('paint 3')).toBe(true)
    expect(rejected('operator 1')).toBe(true)
  })

  it('rejects URLs, javascript:, paths, hashes and unknown programs', () => {
    for (const input of [
      'https://example.com',
      'http://localhost:5173/#/paint',
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,hi',
      '#/paint',
      '../paint',
      'paint?tab=x',
      'c:\\windows\\notepad.exe',
      'notepad',
      'frame-props',
      'live-wizard',
      'run',
      '',
      'x'.repeat(200),
    ]) {
      expect(rejected(input), input).toBe(true)
    }
    expect(parseRunCommand('nonsense')).toMatchObject({
      ok: false,
      error: expect.stringContaining("cannot find 'nonsense'"),
    })
  })
})

describe('Run… and retired programs', () => {
  it('treats every retired program as an unknown command', () => {
    for (const name of [
      'flipbook',
      'weeds',
      'forks',
      'brushes',
      'dna',
      'sleepwalker',
      'lanes',
      'defrag',
      'page',
      'page-exe',
      'page.exe',
      'cardmem',
      'card-mem',
      'kernel',
      'kernel-debugger',
      'router',
      'card 307',
    ]) {
      expect(rejected(name), name).toBe(true)
    }
    for (const id of Object.values(RUN_COMMANDS)) expect(isRetiredProgram(id), id).toBe(false)
  })

  it('openProgram refuses retired programs, even with reveal-all on', () => {
    __setReleaseSnapshotForTests({ status: 'ready', config: { programs: {} }, revealAll: true })
    for (const id of RETIRED_PROGRAMS) {
      expect(programById(id), id).toBeUndefined()
      expect(openProgram(id, false), id).toBe(false)
    }
  })
})

describe('Run… and release gating', () => {
  afterEach(() =>
    __setReleaseSnapshotForTests({ status: 'ready', config: { programs: {} }, revealAll: true }),
  )

  it('cannot open an unreleased program: openProgram enforces the schedule', () => {
    __setReleaseSnapshotForTests({
      status: 'ready',
      config: { programs: { auction: '2026-11-08T18:00:00Z' } },
      now: Date.parse('2026-10-01T00:00:00Z'),
      revealAll: false,
    })
    const auction = target('auction')
    expect(openProgram(auction.program, false)).toBe(false)
  })
})
