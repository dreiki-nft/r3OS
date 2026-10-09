import { useEffect, useMemo, useRef, useState } from 'react'
import { getCanvasSnapshot } from '../paint/canvasStore'
import { PALETTE } from '../lib/palette'
import { openProgram } from '../os/programs'
import { Button } from '../os/ui/Button'
import {
  createCanvasAt,
  eventTime,
  eventsAtFraction,
  formatReplayTime,
  fractionOfEvent,
  parseReplay,
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

export function ReplayProgram() {
  const [load, setLoad] = useState<Load>({ state: 'loading' })

  useEffect(() => {
    const season = Number(getCanvasSnapshot().season)
    const controller = new AbortController()
    void fetch(`/replay/season-${season}.json`, { cache: 'no-cache', signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) return setLoad({ state: 'missing', season })
        if (!response.ok) throw new Error(String(response.status))
        setLoad({ state: 'ready', replay: parseReplay(await response.json()) })
      })
      .catch((error) => {
        if ((error as Error).name !== 'AbortError') setLoad({ state: 'error' })
      })
    return () => controller.abort()
  }, [])

  if (load.state === 'loading') return <div className="replay-empty">loading the season…</div>
  if (load.state === 'error')
    return <div className="replay-empty">the replay file couldn't be read. try again later.</div>
  if (load.state === 'missing' || load.replay.events.length === 0)
    return (
      <div className="replay-empty">
        <b>no replay yet for this season.</b>
        <span>it is exported from the chain with scripts/export-replay.mjs.</span>
        <Button onClick={() => openProgram('paint')}>Open Paint</Button>
      </div>
    )
  return <ReplayPlayer replay={load.replay} />
}

function ReplayPlayer({ replay }: { replay: Replay }) {
  usePainterNames()
  const total = replay.events.length
  const canvasAt = useMemo(() => createCanvasAt(replay), [replay])
  const ref = useRef<HTMLCanvasElement>(null)
  const [axis, setAxis] = useState<Axis>('strokes')
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>(30)
  const [t, setT] = useState(() => (reducedMotion() ? 1 : 0))
  const [playing, setPlaying] = useState(() => !reducedMotion())
  const count = axis === 'strokes' ? Math.round(t * total) : eventsAtFraction(replay, t)

  // Draw whenever the number of applied events changes.
  useEffect(() => {
    const context = ref.current?.getContext('2d')
    if (!context) return
    const pixels = canvasAt(count)
    const image = context.createImageData(256, 256)
    const { outlineMask } = replay
    const { face, background } = replay.file
    for (let i = 0; i < pixels.length; i++) {
      const index = outlineMask[i] ? face : pixels[i] === 0 ? background : pixels[i]
      const [r, g, b] = PALETTE[index].rgb
      image.data[i * 4] = r
      image.data[i * 4 + 1] = g
      image.data[i * 4 + 2] = b
      image.data[i * 4 + 3] = 255
    }
    context.putImageData(image, 0, 0)
  }, [count, canvasAt, replay])

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
  const when =
    count > 0 ? formatReplayTime(eventTime(replay, count - 1)) : formatReplayTime(replay.file.fromTime)

  return (
    <div className="replay-program">
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
        <span className="replay-latest">{latest ? `last: ${painterName(latest)}` : 'blank canvas'}</span>
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
        {t >= 1 && <Button onClick={() => openProgram('paint')}>Paint on it now ▸</Button>}
      </div>
      <small className="replay-source">
        every paint of season {replay.file.season + 1} from the contract's Painted events, blocks{' '}
        {replay.file.fromBlock}–{replay.file.toBlock}
      </small>
    </div>
  )
}
