/**
 * AGENT.EXE: the season 2 opener. 77 AI agents take the canvas at the start of season 2 and defend their face
 * for 72 hours; humans fight back. The agents run on their own server; r3OS only shows the scoreboard they
 * publish and hides the background picker while the battle is on.
 */
export const AGENT_EXE_START = Date.parse('2026-11-05T11:00:00Z')
export const AGENT_EXE_HOURS = 72
export const AGENT_EXE_END = AGENT_EXE_START + AGENT_EXE_HOURS * 3_600_000

/** True from the takeover until the scheduled end (an early human win still keeps the picker locked). */
export function agentExeBattleOn(now = Date.now()) {
  return now >= AGENT_EXE_START && now < AGENT_EXE_END
}

/** Which 24-hour window (0, 1, 2) a moment falls in, or -1 outside the battle. */
export function agentExeDay(now = Date.now()) {
  if (!agentExeBattleOn(now)) return -1
  return Math.floor((now - AGENT_EXE_START) / 86_400_000)
}

/** "71:12:03" until the end; "0:00:00" after it. */
export function agentExeClock(now = Date.now()) {
  const left = Math.max(0, AGENT_EXE_END - now)
  const s = Math.floor(left / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
