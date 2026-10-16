import { useEffect, useState, useSyncExternalStore } from 'react'
import './agentexe.css'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { painterName, usePainterNames } from '../chain/names'
import { markProgramDataReady } from '../chain/perf'
import { openProgram } from '../os/programs'
import { Button } from '../os/ui/Button'
import { Tabs } from '../os/ui/Tabs'
import { AGENT_EXE_START, agentExeClock, agentExeDay } from './schedule'
import { monText, useScoreboard, type Scoreboard } from './scoreboard'

const TABS = ['Feed', 'Leaderboard', 'Rules'] as const
type Tab = (typeof TABS)[number]

export const AGENT_EXE_RULES = [
  'at 11:00 UTC on November 5, 77 AI agents took over the canvas. for 72 hours they repaint their face over anything you draw.',
  'the AI starts with 1,333 MON of health. every pixel of the face you break that an agent has to repair costs it 0.008 MON of damage tax plus the gas of the repair.',
  'drain its health to 0 and humans win.',
  'painting over the AI while it is still drawing the face counts as fighting, but only breaking pixels it has already drawn counts as damage.',
  'the tax goes into the war chest (the AgentBattle contract). after the battle it is shared by badge holders, in proportion to the damage each one did.',
  'badge: fight in all three 24-hour windows (each starts at 11:00 UTC). it lands on your Painter Pass as a quest.',
  'prizes by MON burned: #1 one r3tard, #2 1,000 MON, #3 500 MON.',
  'no bots, one prize per person. everything is reviewed before payouts, which happen within 72 hours of the end. the team does not play.',
  'the background colour is locked during the battle.',
] as const

const utc = (t: number) => new Date(t * 1000).toISOString().slice(11, 16)
const ago = (ms: number) => (ms < 90_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60_000)} min`)

export function AgentExeProgram() {
  const sb = useScoreboard()
  const [tab, setTab] = useState<Tab>('Feed')
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  useEffect(() => {
    if (sb.status !== 'loading') markProgramDataReady('agent-exe')
  }, [sb.status])

  return (
    <div className="agentexe">
      <header className="agentexe-head">
        <div className="agentexe-title" data-text="AGENT.EXE">
          AGENT.EXE
        </div>
        <div className="agentexe-clock">
          {now < AGENT_EXE_START ? 'booting…' : sb.status === 'ready' ? phaseText(sb.board, now) : `ends in ${agentExeClock(now)}`}
        </div>
      </header>
      {sb.status === 'ready' ? (
        <Board board={sb.board} fetchedAt={sb.fetchedAt} now={now} tab={tab} setTab={setTab} />
      ) : (
        <div className="agentexe-offline sunken">
          <b>{sb.status === 'loading' ? 'connecting to AGENT.EXE…' : 'the scoreboard is not reachable right now.'}</b>
          <span>the battle runs onchain whether or not this window can see it. you can paint anyway.</span>
          <Button onClick={() => openProgram('paint')}>Open Paint</Button>
          <Rules />
        </div>
      )}
    </div>
  )
}

function phaseText(board: Scoreboard, now: number) {
  if (board.phase === 'defeated') return 'AI DEFEATED · HUMANS WIN'
  if (board.phase === 'ended') return 'BATTLE OVER · THE AI SURVIVED'
  const day = agentExeDay(now)
  return `${day >= 0 ? `day ${day + 1}/3 · ` : ''}ends in ${agentExeClock(now)}`
}

function Board({
  board,
  fetchedAt,
  now,
  tab,
  setTab,
}: {
  board: Scoreboard
  fetchedAt: number
  now: number
  tab: Tab
  setTab: (t: Tab) => void
}) {
  usePainterNames()
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const me = wallet.account?.toLowerCase()
  const mine = me ? board.leaderboard.find((w) => w.address === me) : undefined
  const stale = now - board.updatedAt * 1000 > 6 * 60_000
  return (
    <>
      <section className="agentexe-health" aria-label="AI health">
        <div className="agentexe-health-label">
          <span>AI INTEGRITY</span>
          <b>
            {monText(board.health.left)} / {monText(board.health.start, 0)} MON
          </b>
        </div>
        <div className="agentexe-bar sunken">
          <i style={{ width: `${Math.max(0, Math.min(100, board.health.pct))}%` }} />
        </div>
      </section>
      <section className="agentexe-stats">
        <Stat label="face drawn" value={`${Math.round(board.ai.drawn * 100)}%`} />
        <Stat label="pixels broken now" value={board.ai.wrongNow.toLocaleString('en-US')} />
        <Stat label="human damage" value={`${board.humans.damage.toLocaleString('en-US')} px`} />
        <Stat label="war chest" value={`${monText(board.warChest.paid)} MON`} />
      </section>
      {board.lastWords && (
        <div className="agentexe-lastwords">{board.lastWords.done ? board.lastWords.text : 'writing its last words…'}</div>
      )}
      {mine ? (
        <div className="agentexe-you">
          you: #{mine.rank} · {monText(mine.burned, 3)} MON burned · {mine.damage.toLocaleString('en-US')} px damage · days{' '}
          {mine.days.map((d) => (d ? '■' : '□')).join('')}
          {mine.badge ? ' · badge earned' : ''}
        </div>
      ) : me ? (
        <div className="agentexe-you">you are not on the board yet. break a pixel of the face to start.</div>
      ) : null}
      <Tabs tabs={[...TABS]} active={tab} onChange={(t) => setTab(t as Tab)} />
      <div className="agentexe-pane sunken">
        {tab === 'Feed' && (
          <ol className="agentexe-feed">
            {[...board.feed].reverse().map((line, k) => (
              <li key={`${line.t}-${k}`} className={`kind-${line.kind}`}>
                <time>{utc(line.t)}</time> {line.text}
              </li>
            ))}
          </ol>
        )}
        {tab === 'Leaderboard' && (
          <table className="agentexe-table">
            <thead>
              <tr>
                <th>#</th>
                <th>painter</th>
                <th>MON burned</th>
                <th>damage</th>
                <th>days</th>
              </tr>
            </thead>
            <tbody>
              {board.leaderboard.slice(0, 50).map((w) => (
                <tr key={w.address} className={w.address === me ? 'me' : ''}>
                  <td>{w.rank}</td>
                  <td title={w.address}>{painterName(w.address)}</td>
                  <td>{monText(w.burned, 3)}</td>
                  <td>{w.damage.toLocaleString('en-US')}</td>
                  <td>
                    {w.days.map((d) => (d ? '■' : '□')).join('')}
                    {w.badge ? ' ★' : ''}
                  </td>
                </tr>
              ))}
              {!board.leaderboard.length && (
                <tr>
                  <td colSpan={5}>nobody has dented it yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {tab === 'Rules' && <Rules />}
      </div>
      <footer className="agentexe-foot">
        {stale ? (
          <span className="warn">the scoreboard is behind (last update {ago(now - board.updatedAt * 1000)} ago). the battle continues onchain.</span>
        ) : (
          <span>
            updated {ago(now - fetchedAt)} ago · block {board.block.toLocaleString('en-US')} · tax {board.warChest.taxPerPixel} MON/px
          </span>
        )}
      </footer>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="agentexe-stat">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  )
}

function Rules() {
  return (
    <ul className="agentexe-rules">
      {AGENT_EXE_RULES.map((r) => (
        <li key={r}>{r}</li>
      ))}
    </ul>
  )
}
