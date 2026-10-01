import { afterEach, describe, expect, it } from 'vitest'
import { RUN_COMMANDS, parseRunCommand } from './run'
import { openProgram, programById } from './programs'
import { __setReleaseSnapshotForTests } from './releases'

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
    expect(target('page').program).toBe('page-exe')
    expect(target('cardmem').program).toBe('card-mem')
    expect(target('camera').program).toBe('block-camera')
    expect(target('kernel').program).toBe('kernel-debugger')
    expect(target('hardware').program).toBe('monad-hw')
  })

  it('is case-insensitive, trims spaces and accepts a trailing .exe', () => {
    expect(target('  ROUTER  ').program).toBe('router')
    expect(target('DxDiag.EXE').program).toBe('dxdiag')
    expect(target('page.exe').program).toBe('page-exe')
  })

  it('builds the operator and argument routes itself', () => {
    expect(target('operator')).toEqual({ program: 'pass', hash: '#/pass?tab=Operator' })
    expect(target('card 307')).toEqual({ program: 'card-mem', hash: '#/card-mem?card=307' })
    expect(target('card 0').hash).toBe('#/card-mem?card=0')
    const max = ((1n << 256n) - 1n).toString()
    expect(target(`card ${max}`).hash).toBe(`#/card-mem?card=${max}`)
    expect(target('frame 12')).toEqual({ program: 'frame-props', hash: '#/frame-props?token=12' })
    expect(target('auction 3')).toEqual({ program: 'auction', hash: '#/auction?auction=3' })
  })

  it('rejects bad arguments and bounds', () => {
    expect(rejected(`card ${(1n << 256n).toString()}`)).toBe(true)
    expect(rejected('card -1')).toBe(true)
    expect(rejected('card 12abc')).toBe(true)
    expect(rejected('card')).toBe(true)
    expect(rejected('card 1 2')).toBe(true)
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

describe('Run… and release gating', () => {
  afterEach(() =>
    __setReleaseSnapshotForTests({ status: 'ready', config: { programs: {} }, revealAll: true }),
  )

  it('cannot open an unreleased program: openProgram enforces the schedule', () => {
    __setReleaseSnapshotForTests({
      status: 'ready',
      config: { programs: { forks: '2026-11-08T18:00:00Z' } },
      now: Date.parse('2026-10-01T00:00:00Z'),
      revealAll: false,
    })
    const forks = target('forks')
    expect(openProgram(forks.program, false)).toBe(false)
  })
})
