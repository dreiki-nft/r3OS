import { describe, expect, it } from 'vitest'
import releases from '../../public/releases.json'
import { parseScoreboard, monText } from './scoreboard'
import { AGENT_EXE_END, AGENT_EXE_START, agentExeBattleOn, agentExeClock, agentExeDay } from './schedule'
import { normalizeReleaseConfig, programVisibleAt } from '../os/releases'

// Shape the agents' controller publishes (agent-exe/src/controller.mjs scoreboard()).
const published = {
  game: 'AGENT.EXE',
  season: 2,
  phase: 'battle',
  startsAt: 1_793_876_400,
  endsAt: 1_794_135_600,
  defeatedAt: null,
  lastWords: null,
  updatedAt: 1_793_880_000,
  block: 120_000_000,
  head: 120_000_002,
  health: { start: '1333', left: '1200.123456789', pct: 90.03 },
  shields: [
    { size: '444.333333333333333333', taken: '132.876543210666666667', brokenAt: null },
    { size: '444.333333333333333333', taken: '0', brokenAt: null },
    { size: '444.333333333333333334', taken: '0', brokenAt: null },
  ],
  dark: null,
  warChest: { paid: '96.4', owed: '100.8', taxPerPixel: '0.008' },
  ai: { agents: 77, drawn: 0.8123, wrongNow: 412, paints: 812, pixels: 70_000, gasBurned: '24.5' },
  humans: { damage: 12_600, broken: 20_000, paints: 3_100 },
  leaderboard: [
    {
      rank: 1,
      address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      burned: '32.6',
      damage: 4077,
      broken: 4100,
      days: [true, true, false],
      badge: false,
    },
    { rank: 2, address: 'not-an-address', burned: '1', damage: 1, broken: 1, days: [], badge: false },
  ],
  feed: [
    { t: 1_793_876_400, text: 'AGENT.EXE HAS ENTERED THE CANVAS.', kind: 'alert' },
    { t: 1_793_876_401, text: '<script>x</script>‮ evil', kind: 'info' },
  ],
}

describe('AGENT.EXE scoreboard', () => {
  it('reads what the controller publishes and drops bad rows', () => {
    const b = parseScoreboard(published)!
    expect(b.phase).toBe('battle')
    expect(b.health.left).toBe('1200.123456789')
    expect(b.leaderboard).toHaveLength(1)
    expect(b.leaderboard[0].address).toBe('0x70997970c51812dc3a010c7d01b50e0d17dc79c8')
    expect(b.leaderboard[0].days).toEqual([true, true, false])
    expect(b.feed[1].text).not.toMatch(/‮/)
    expect(b.ai.agents).toBe(77)
    expect(b.shields).toHaveLength(3)
    expect(b.shields[0].taken).toBe('132.876543210666666667')
    expect(b.dark).toBeNull()
    expect(parseScoreboard({ ...published, dark: { until: 1_793_962_800 } })!.dark).toEqual({ until: 1_793_962_800 })
  })

  it('refuses anything that is not a scoreboard', () => {
    expect(parseScoreboard(null)).toBeUndefined()
    expect(parseScoreboard({ ...published, game: 'X' })).toBeUndefined()
    expect(parseScoreboard({ ...published, phase: 'party' })).toBeUndefined()
    expect(parseScoreboard({ ...published, health: { start: '1333', left: '-5', pct: 1 } })).toBeUndefined()
    expect(parseScoreboard({ ...published, health: { start: '1333', left: '5', pct: 400 } })).toBeUndefined()
  })

  it('formats MON without float noise', () => {
    expect(monText('1333')).toBe('1,333')
    expect(monText('1200.1234', 1)).toBe('1,200.1')
    expect(monText('0.0080', 3)).toBe('0.008')
    expect(monText('5.000', 2)).toBe('5')
  })
})

describe('AGENT.EXE schedule', () => {
  it('runs 72 hours from Nov 5 11:00 UTC, in three days', () => {
    expect(new Date(AGENT_EXE_START).toISOString()).toBe('2026-11-05T11:00:00.000Z')
    expect(new Date(AGENT_EXE_END).toISOString()).toBe('2026-11-08T11:00:00.000Z')
    expect(agentExeBattleOn(AGENT_EXE_START - 1)).toBe(false)
    expect(agentExeBattleOn(AGENT_EXE_START)).toBe(true)
    expect(agentExeBattleOn(AGENT_EXE_END)).toBe(false)
    expect(agentExeDay(AGENT_EXE_START + 86_400_000)).toBe(1)
    expect(agentExeDay(AGENT_EXE_END - 1)).toBe(2)
    expect(agentExeClock(AGENT_EXE_START)).toBe('72:00:00')
  })

  it('the window stays hidden until the takeover, by the public release schedule', () => {
    const schedule = normalizeReleaseConfig(releases)
    expect(Date.parse(schedule.programs['agent-exe'])).toBe(AGENT_EXE_START)
    expect(programVisibleAt(schedule, 'agent-exe', AGENT_EXE_START - 1)).toBe(false)
    expect(programVisibleAt(schedule, 'agent-exe', AGENT_EXE_START)).toBe(true)
  })
})
