/**
 * r3OS broadcast view (#/tv): the shared canvas full-screen for a projector or a stream, with every new
 * stroke flashing where it lands, who is painting right now, a paint-party prompt and a QR code to join.
 * It reads the same canvas store and events as Paint; it never signs anything and never shows URL text.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { PALETTE } from '../lib/palette'
import { shortAddress } from '../os/activity'
import { getCanvasSnapshot, subscribeCanvas, subscribeCanvasActivity } from '../paint/canvasStore'
import {
  getPresenceSnapshot,
  PRESENCE_WINDOW_BLOCKS,
  subscribePresence,
  summarize,
  windowLabel,
} from '../paint/presence'
import { PARTY_PROMPTS } from './prompts'
import { QR_LABEL, QR_ROWS, qrPath } from './qr'
import {
  boxPercent,
  FLASH_MS,
  mergeTvStrokes,
  onAirLabel,
  painterColour,
  partyStats,
  promptIndex,
  promptProgress,
  topPainters,
  tvFrameFromActivity,
  tvStrokeFromActivity,
  type TvFrame,
  type TvStroke,
} from './tvModel'
import './tv.css'

const MAX_FLASHES = 40
/** Only the newest flashes get a name tag, so a busy corner stays readable. */
const LABELLED_FLASHES = 10
const FEED_ROWS = 7

function exitTv() {
  if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined)
  location.hash = '#/paint'
}

function TvCanvas() {
  const snapshot = useSyncExternalStore(subscribeCanvas, getCanvasSnapshot)
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = ref.current?.getContext('2d')
    if (!context) return
    const image = context.createImageData(256, 256)
    const { background: pixels, outline, face, backgroundColor } = snapshot
    for (let index = 0; index < pixels.length; index++) {
      const paletteIndex = outline[index] ? face : pixels[index] === 0 ? backgroundColor : pixels[index]
      const [red, green, blue] = PALETTE[paletteIndex & 15].rgb
      const offset = index * 4
      image.data[offset] = red
      image.data[offset + 1] = green
      image.data[offset + 2] = blue
      image.data[offset + 3] = 255
    }
    context.putImageData(image, 0, 0)
  }, [snapshot.background, snapshot.outline, snapshot.face, snapshot.backgroundColor])
  return <canvas ref={ref} width={256} height={256} aria-label="the shared r3OS canvas, live" />
}

function BlockTicker() {
  const block = useSyncExternalStore(subscribeBlocks, () => getBlockSnapshot().block)
  const blockMs = useSyncExternalStore(subscribeBlocks, () => getBlockSnapshot().blockTimeMs)
  if (!block) return <span className="tv-block">tuning in to Monad…</span>
  return (
    <span className="tv-block">
      Monad block <b>{block.toLocaleString('en-US')}</b> · {(blockMs / 1_000).toFixed(2)} s blocks
    </span>
  )
}

function Qr() {
  const size = QR_ROWS.length + 4
  const path = useMemo(() => qrPath(), [])
  return (
    <svg className="tv-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`QR code: ${QR_LABEL}`}>
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}

export function TvView() {
  const openedAt = useRef(Date.now())
  const [strokes, setStrokes] = useState<TvStroke[]>([])
  const [frames, setFrames] = useState<TvFrame[]>([])
  const [now, setNow] = useState(() => Date.now())
  const [shift, setShift] = useState(0)
  const [panel, setPanel] = useState(true)
  const [idle, setIdle] = useState(false)
  const presence = useSyncExternalStore(subscribePresence, getPresenceSnapshot)

  // Strokes from the start-up look-back (no colour known: use the painter's colour; never flashed).
  useEffect(() => {
    if (!presence.strokes.length) return
    setStrokes((current) =>
      mergeTvStrokes(
        current,
        presence.strokes.map((stroke) => ({
          ...stroke,
          colour: painterColour(stroke.owner),
          seenAt: 0,
          live: false,
        })),
      ),
    )
  }, [presence.strokes])

  // Live strokes and frames, straight from the canvas store's event stream.
  useEffect(
    () =>
      subscribeCanvasActivity((activity) => {
        const at = Date.now()
        const stroke = tvStrokeFromActivity(activity, at)
        if (stroke) setStrokes((current) => mergeTvStrokes(current, [stroke]))
        const frame = tvFrameFromActivity(activity, at)
        if (frame)
          setFrames((current) =>
            current.some((row) => row.key === frame.key) ? current : [frame, ...current],
          )
      }),
    [],
  )

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [])

  // Host controls: ← / → prompt, F fullscreen, H hide the side panel, Esc back to the desktop.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === 'ArrowRight') setShift((value) => value + 1)
      else if (event.key === 'ArrowLeft') setShift((value) => value - 1)
      else if (event.key === 'f' || event.key === 'F') toggleFullscreen()
      else if (event.key === 'h' || event.key === 'H') setPanel((value) => !value)
      else if (event.key === 'Escape' && !document.fullscreenElement) exitTv()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Hide the cursor and the controls when nobody touches the screen for a few seconds.
  useEffect(() => {
    let timer = window.setTimeout(() => setIdle(true), 3_000)
    const wake = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), 3_000)
    }
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
    }
  }, [])

  const head = getBlockSnapshot().block
  const blockMs = getBlockSnapshot().blockTimeMs
  const recent = summarize(strokes, head, PRESENCE_WINDOW_BLOCKS)
  const party = partyStats(strokes, frames)
  const leaders = topPainters(strokes, 5)
  const flashes = strokes
    .filter((stroke) => stroke.live && now - stroke.seenAt < FLASH_MS)
    .slice(0, MAX_FLASHES)
  const elapsed = now - openedAt.current
  const promptAt = promptIndex(elapsed, shift, PARTY_PROMPTS.length)
  const prompt = PARTY_PROMPTS[promptAt]
  const season = presence.season?.season ?? getCanvasSnapshot().season
  const feed = [
    ...strokes
      .slice(0, FEED_ROWS)
      .map((stroke) => ({ kind: 'paint' as const, block: stroke.block, key: stroke.key, stroke })),
    ...frames
      .slice(0, FEED_ROWS)
      .map((frame) => ({ kind: 'frame' as const, block: frame.block, key: frame.key, frame })),
  ]
    .sort((a, b) => (a.block === b.block ? 0 : a.block > b.block ? -1 : 1))
    .slice(0, FEED_ROWS)
  const ago = (block: bigint) => {
    const seconds = head > block ? Math.round((Number(head - block) * (blockMs || 400)) / 1_000) : 0
    return seconds < 60
      ? `${seconds}s`
      : seconds < 3_600
        ? `${Math.round(seconds / 60)}m`
        : `${Math.round(seconds / 3_600)}h`
  }

  return (
    <div
      className={`tv ${panel ? '' : 'tv-no-panel'} ${idle ? 'tv-idle' : ''}`}
      role="region"
      aria-label="r3OS broadcast"
    >
      <div className="tv-stage">
        <div className="tv-canvas">
          <TvCanvas />
          <div className="tv-flashes" aria-hidden="true">
            {flashes.map((stroke, index) => {
              const box = boxPercent(stroke.box)
              return (
                <div
                  key={stroke.key}
                  className={`tv-flash ${box.top < 8 ? 'tv-flash-below' : ''}`}
                  style={{
                    left: `${box.left}%`,
                    top: `${box.top}%`,
                    width: `${box.width}%`,
                    height: `${box.height}%`,
                    ['--c' as string]: PALETTE[stroke.colour].hex,
                  }}
                >
                  {index < LABELLED_FLASHES && (
                    <span>
                      {shortAddress(stroke.owner)} +{stroke.pixels}px
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {panel && (
        <aside className="tv-panel">
          <header className="tv-head">
            <span className="tv-onair">
              <i /> ON AIR
            </span>
            <span>r3OS · season {season.toString()}</span>
          </header>

          <section className="tv-now" aria-live="polite">
            <b>{recent.painters}</b>
            <span>
              painting right now
              <small>
                last {windowLabel(PRESENCE_WINDOW_BLOCKS, blockMs)} · {recent.strokes} strokes ·{' '}
                {recent.pixels.toLocaleString('en-US')} px
              </small>
            </span>
          </section>

          <section className="tv-party">
            <h2>this party · on air {onAirLabel(elapsed)}</h2>
            <dl>
              <div>
                <dt>painters</dt>
                <dd>{party.painters}</dd>
              </div>
              <div>
                <dt>strokes</dt>
                <dd>{party.paints.toLocaleString('en-US')}</dd>
              </div>
              <div>
                <dt>pixels</dt>
                <dd>{party.pixels.toLocaleString('en-US')}</dd>
              </div>
              <div>
                <dt>frames saved</dt>
                <dd>{party.frames}</dd>
              </div>
            </dl>
          </section>

          <section className="tv-prompt">
            <h2>
              prompt {promptAt + 1}/{PARTY_PROMPTS.length}
            </h2>
            <p className="tv-prompt-title">{prompt.title}</p>
            <p className="tv-prompt-hint">{prompt.hint}</p>
            <div className="tv-prompt-bar">
              <i style={{ width: `${(1 - promptProgress(elapsed)) * 100}%` }} />
            </div>
          </section>

          <section className="tv-feed">
            <h2>latest</h2>
            {feed.length ? (
              <ol>
                {feed.map((row) =>
                  row.kind === 'paint' ? (
                    <li key={row.key}>
                      <i style={{ background: PALETTE[row.stroke.colour].hex }} />
                      <span>{shortAddress(row.stroke.owner)}</span>
                      <span>+{row.stroke.pixels}px</span>
                      <span>{ago(row.block)}</span>
                    </li>
                  ) : (
                    <li key={row.key} className="tv-feed-frame">
                      <i />
                      <span>{shortAddress(row.frame.minter)}</span>
                      <span>saved frame #{row.frame.tokenId.toString()}</span>
                      <span>{ago(row.block)}</span>
                    </li>
                  ),
                )}
              </ol>
            ) : (
              <p className="tv-empty">waiting for the first stroke… scan the code and paint.</p>
            )}
          </section>

          {leaders.length > 1 && (
            <section className="tv-top">
              <h2>most pixels tonight</h2>
              <ol>
                {leaders.map((row) => (
                  <li key={row.owner}>
                    <i style={{ background: PALETTE[row.colour].hex }} />
                    <span>{shortAddress(row.owner)}</span>
                    <span>{row.pixels.toLocaleString('en-US')} px</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <footer className="tv-join">
            <Qr />
            <div>
              <p>paint with us</p>
              <p className="tv-url">{QR_LABEL}</p>
              <p className="tv-small">every stroke is a Monad transaction</p>
              <BlockTicker />
            </div>
          </footer>
        </aside>
      )}

      <div className="tv-controls">
        <span>← → prompt · F fullscreen · H panel · Esc exit</span>
        <button type="button" onClick={toggleFullscreen} aria-label="Toggle fullscreen">
          ⛶
        </button>
        <button type="button" onClick={exitTv} aria-label="Exit broadcast view">
          ✕
        </button>
      </div>
    </div>
  )
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined)
  else void document.documentElement.requestFullscreen?.().catch(() => undefined)
}
