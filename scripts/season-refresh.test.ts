import { describe, expect, it } from 'vitest'
import { expandHome, finishedStorms, parseConfig, plan, refreshedFiles } from './season-refresh-lib.mjs'

const A = '0x00000000000000000000000000000000000000a1'

describe('season refresh', () => {
  it('counts only season storms that have fully ended', () => {
    expect(finishedStorms(115_400_598n)).toEqual([])
    expect(finishedStorms(115_400_599n)).toEqual([115_400_000n])
    expect(finishedStorms(116_200_100n)).toHaveLength(4)
    expect(finishedStorms(116_200_599n)).toHaveLength(5)
    const all = finishedStorms(130_000_000n)
    expect(all).toHaveLength(21)
    expect(all.at(-1)).toBe(119_400_000n)
  })

  it('reads the local exclude config and expands ~', () => {
    expect(expandHome('~/Desktop/files/anon-wallets.json', '/c/Users/dre')).toBe(
      '/c/Users/dre/Desktop/files/anon-wallets.json',
    )
    expect(expandHome('guest-wallets.local.json', '/h')).toBe('guest-wallets.local.json')
    const config = parseConfig(JSON.stringify({ exclude: [A], excludeFiles: ['~/x.json'] }), '/h')
    expect(config).toEqual({ exclude: [A], excludeFiles: ['/h/x.json'], agentFiles: [] })
    expect(parseConfig(JSON.stringify({ agentFiles: ['~/agents.json'] }), '/h').agentFiles).toEqual([
      '/h/agents.json',
    ])
    expect(() => parseConfig(JSON.stringify({ exclude: ['nope'] }))).toThrow(/not an address/)
  })

  it('uses the same exclusions for stats and storm tickets, and never puts the rpc in a label', () => {
    const steps = plan({
      storms: [115_400_000n, 115_600_000n],
      exclude: [A],
      excludeFiles: ['/h/anons.json'],
      rpc: 'https://secret.example/key',
    })
    expect(steps.map((step) => step.script)).toEqual([
      'scripts/export-replay.mjs',
      'scripts/export-sessions.mjs',
      'scripts/community-stats.mjs',
      'scripts/season-chart.mjs',
      'scripts/storm-chasers.mjs',
    ])
    const stats = steps[2].args.join(' ')
    const storms = steps[4].args.join(' ')
    for (const args of [stats, storms]) expect(args).toContain(`--exclude ${A} --exclude-file /h/anons.json`)
    expect(storms).toContain('--storms 115400000,115600000')
    expect(storms).toContain('--public public/storms/season-1.json')
    expect(steps[2].stdoutTo).toBe('docs/season-stats.json')
    for (const step of steps) expect(step.label).not.toContain('secret')
    expect(plan({ storms: [], exclude: [], excludeFiles: [] })).toHaveLength(4)
  })

  it('counts later seasons on their own, with AI agents apart, and leaves season 1 files alone', () => {
    const steps = plan({
      season: 1,
      storms: [115_400_000n],
      exclude: [A],
      excludeFiles: ['/h/anons.json'],
      agentFiles: ['/h/agents.json'],
    })
    expect(steps.map((step) => step.script)).toEqual([
      'scripts/export-replay.mjs',
      'scripts/export-sessions.mjs',
      'scripts/community-stats.mjs',
      'scripts/season-chart.mjs',
    ])
    const stats = steps[2].args.join(' ')
    expect(stats).toContain('--season 1')
    expect(stats).toContain('--agents-file /h/agents.json')
    expect(stats).toContain('--exclude-file /h/anons.json')
    expect(stats).not.toContain('painters.json')
    expect(steps[0].args).toEqual(['--season', '1'])
    expect(steps[2].stdoutTo).toBe('docs/season-2-stats.json')
    expect(steps[3].args).toEqual([
      '--in',
      'docs/season-2-stats.json',
      '--out',
      'docs/media/season-2-days.svg',
    ])
    expect(refreshedFiles(1)).toEqual([
      'public/replay',
      'public/live/sessions.json',
      'docs/season-2-stats.json',
      'docs/media/season-2-days.svg',
    ])
    expect(refreshedFiles(0)).toContain('public/storms/season-1.json')
    expect(plan({ storms: [], exclude: [], excludeFiles: [] })[2].args).toContain('--painters-out')
  })
})
