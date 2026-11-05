import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { getCanvasSnapshot, subscribeCanvas } from '../paint/canvasStore'
import { PALETTE } from '../lib/palette'
import { openProgram } from '../os/programs'
import { Button } from '../os/ui/Button'
import {
  createCanvasAt,
  eventTime,
  eventsAtFraction,
  formatReplayTime,
  fractionOfEvent,
  liveCanvasFollows,
  parseReplay,
  replayHash,
  replaySeasons,
  seasonFromHash,
  type Replay,
} from './replayData'
import './replay.css'
import { painterName, usePainterNames } from '../chain/names'

type Load =
  | { state: 'loading' }
  | { state: 'missing'; season: number }
  | { state: 'error' }
  | { state: 'ready'; replay: Replay }
type Axis = 'strokes' | 'time'

const DURATIONS = [15, 30, 60] as const
const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

// A finished season's file never changes, so it is parsed once per visit; the current season is always refetched.
const finishedSeasons = new Map<number, Replay>()

const currentSeasonOf = () => getCanvasSnapshot().season

export function ReplayProgram() {
  const current = Number(useSyncExternalStore(subscribeCanvas, currentSeasonOf))
  // Until someone picks a season (or opens a #/replay?season=N link), the replay follows the current season.
  const [picked, setPicked] = useState(() => seasonFromHash(location.hash))
  const season = picked ?? current
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  useEffect(() => {
    const onHashChange = () => {
      const fromHash = seasonFromHash(location.hash)
      if (fromHash != null) setPicked(fromHash)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    const cached = finishedSeasons.get(season)
    if (cached && season < current) return setLoad({ state: 'ready', replay: cached })
    setLoad({ state: 'loading' })
    const controller = new AbortController()
    void fetch(`/replay/season-${season}.json`, { cache: 'no-cache', signal: controller.signal })
      .then(async (response) => {
        // A missing file is a 404 on Vercel; dev servers answer with the app's index.html instead.
        const json = (response.headers.get('content-type') ?? '').includes('json')
        if (response.status === 404 || (response.ok && !json)) return setLoad({ state: 'missing', season })
        if (!response.ok) throw new Error(String(response.status))
        const replay = parseReplay(await response.json())
        if (replay.file.season !== season) throw new Error('season mismatch')
        if (season < current) finishedSeasons.set(season, replay)
        setLoad({ state: 'ready', replay })
      })
      .catch((error) => {
        if ((error as Error).name !== 'AbortError') setLoad({ state: 'error' })
      })
    return () => controller.abort()
  }, [season, current])

  const pick = (next: number) => {
    setPicked(next)
    // Keep the address shareable (#/replay?season=1) without re-routing the desktop.
    if (location.hash.startsWith('#/replay')) history.replaceState(null, '', replayHash(next))
  }
  const picker = (
    <SeasonPicker seasons={replaySeasons(Math.max(current, season))} season={season} current={current} onPick={pick} />
  )

  if (load.state === 'loading')
    return (
      <div className="replay-empty">
        {picker}
        loading season {season + 1}…
      </div>
    )
  if (load.state === 'error')
    return (
      <div className="replay-empty">
        {picker}
        the replay file couldn't be read. try again later.
      </div>
    )
  if (load.state === 'missing' || load.replay.events.length === 0)
    return (
      <div className="replay-empty">
        {picker}
        <b>no replay yet for season {season + 1}.</b>
        <span>it is exported from the chain with scripts/export-replay.mjs.</span>
        <div className="replay-controls">
          {season > 0 && (
            <Button primary onClick={() => pick(season - 1)}>
              Watch season {season} ▸
            </Button>
          )}
          <Button onClick={() => openProgram('paint')}>Open Paint</Button>
        </div>
      </div>
    )
  return (
    <ReplayPlayer key={season} replay={load.replay} picker={picker} isCurrent={season === current} />
  )
}

function SeasonPicker({
  seasons,
  season,
  current,
  onPick,
}: {
  seasons: number[]
  season: number
  current: number
  onPick: (season: number) => void
}) {
  if (seasons.length < 2) return null
  return (
    <label className="replay-season">
      watch
      <select value={season} onChange={(event) => onPick(Number(event.target.value))}>
        {seasons.map((value) => (
          <option key={value} value={value}>
            season {value + 1}
            {value === current ? ' (now)' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

function ReplayPlayer({
  replay,
  picker,
  isCurrent,
}: {
  replay: Replay
  picker: ReactNode
  isCurrent: boolean
}) {
  usePainterNames()
  const total = replay.events.length
  const canvasAt = useMemo(() => createCanvasAt(replay), [replay])
  const ref = useRef<HTMLCanvasElement>(null)
  const [axis, setAxis] = useState<Axis>('strokes')
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>(30)
  const [t, setT] = useState(() => (reducedMotion() ? 1 : 0))
  const [playing, setPlaying] = useState(() => !reducedMotion())
  const count = axis === 'strokes' ? Math.round(t * total) : eventsAtFraction(replay, t)
  // At the end, show the live canvas: it includes everything painted after the file was exported.
  const live = useSyncExternalStore(subscribeCanvas, getCanvasSnapshot)
  const showLive = t >= 1 && liveCanvasFollows(replay.file, live)
  const liveFrame = showLive ? live : undefined

  // Draw whenever the number of applied events changes (or the live canvas does, once it is on screen).
  useEffect(() => {
    const context = ref.current?.getContext('2d')
    if (!context) return
    const pixels = liveFrame ? liveFrame.background : canvasAt(count)
    const outlineMask = liveFrame ? liveFrame.outline : replay.outlineMask
    const face = liveFrame ? liveFrame.face : replay.file.face
    const background = liveFrame ? liveFrame.backgroundColor : replay.file.background
    const image = context.createImageData(256, 256)
    for (let i = 0; i < pixels.length; i++) {
      const index = outlineMask[i] ? face : pixels[i] === 0 ? background : pixels[i]
      const [r, g, b] = PALETTE[index].rgb
      image.data[i * 4] = r
      image.data[i * 4 + 1] = g
      image.data[i * 4 + 2] = b
      image.data[i * 4 + 3] = 255
    }
    context.putImageData(image, 0, 0)
  }, [count, canvasAt, replay, liveFrame])

  // Playback: the whole season in `duration` seconds.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    const step = (now: number) => {
      const dt = (now - last) / 1_000
      last = now
      setT((value) => {
        const next = value + dt / duration
        // Snap the last sliver so playback always ends exactly on the final canvas.
        return next >= 0.999 ? 1 : next
      })
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [playing, duration])

  useEffect(() => {
    if (playing && t >= 1) setPlaying(false)
  }, [playing, t])

  const switchAxis = (next: Axis) => {
    // Keep the same moment on screen when switching between "every stroke" and "real time".
    setT(next === 'strokes' ? count / Math.max(1, total) : fractionOfEvent(replay, count))
    setAxis(next)
  }

  const painters = count > 0 ? replay.paintersSoFar[count - 1] : 0
  const latest = count > 0 ? replay.file.painters[replay.events[count - 1].painter] : undefined
  const when = showLive
    ? 'now'
    : count > 0
      ? formatReplayTime(eventTime(replay, count - 1))
      : formatReplayTime(replay.file.fromTime)

  return (
    <div className="replay-program">
      {picker}
      <div className="replay-screen sunken">
        <canvas
          ref={ref}
          width={256}
          height={256}
          aria-label="the shared canvas, replayed stroke by stroke"
        />
      </div>
      <div className="replay-readout" role="status">
        <span>{when}</span>
        <span>
          <b>{painters.toLocaleString('en-US')}</b> painter{painters === 1 ? '' : 's'}
        </span>
        <span>
          <b>{count.toLocaleString('en-US')}</b> / {total.toLocaleString('en-US')} paints
        </span>
        <span className="replay-latest">
          {showLive ? 'the live canvas' : latest ? `last: ${painterName(latest)}` : 'blank canvas'}
        </span>
      </div>
      <input
        className="replay-scrub"
        type="range"
        min={0}
        max={1000}
        value={Math.round(t * 1000)}
        aria-label="replay position"
        onChange={(event) => {
          setPlaying(false)
          setT(Number(event.target.value) / 1000)
        }}
      />
      <div className="replay-controls">
        <Button
          primary
          onClick={() => {
            if (t >= 1) setT(0)
            setPlaying(!playing)
          }}
        >
          {playing ? '❚❚ Pause' : t >= 1 ? '↺ Replay' : '▶ Play'}
        </Button>
        <label>
          season in
          <select
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value) as (typeof DURATIONS)[number])}
          >
            {DURATIONS.map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds} s
              </option>
            ))}
          </select>
        </label>
        <label title="every stroke gets equal time, or follow the real clock (quiet hours pass quickly)">
          <select value={axis} onChange={(event) => switchAxis(event.target.value as Axis)}>
            <option value="strokes">every stroke</option>
            <option value="time">real time</option>
          </select>
        </label>
        {t >= 1 && isCurrent && <Button onClick={() => openProgram('paint')}>Paint on it now ▸</Button>}
      </div>
      <small className="replay-source">
        every paint of season {replay.file.season + 1} from the contract's Painted events, blocks{' '}
        {replay.file.fromBlock}–{replay.file.toBlock}
        {showLive ? `, ending on the live canvas at block ${live.snapshotBlock}` : ''}
      </small>
    </div>
  )
}
