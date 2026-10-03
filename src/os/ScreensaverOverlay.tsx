import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { getTxTraceSnapshot, subscribeTxTrace } from '../chain/txTrace'
import { getCanvasSnapshot, subscribeCanvas, subscribeCanvasActivity } from '../paint/canvasStore'
import { PALETTE } from '../lib/palette'
import { getBlockPlayerPlaying, subscribeBlockPlayer } from '../monadhw/blockPlayer'
import { getConfirm, subscribeConfirm } from './confirm'
import { isBooting, subscribeBooting } from './bootState'
import { getFloppyRequest, subscribeFloppy } from './floppy'
import { isFirstRunOpen, subscribeFirstRun } from './firstRunState'
import { programById } from './programs'
import {
  canStartScreensaver,
  getScreensaverSetting,
  hasRecentPendingTx,
  subscribeScreensaverSetting,
} from './screensaver'
import { getWindows, subscribeWindows } from './windows'

const WAIT_MS = 3 * 60_000

function useNarrowOrTouch() {
  const read = () =>
    typeof matchMedia !== 'undefined' &&
    (matchMedia('(max-width: 640px)').matches || matchMedia('(pointer: coarse)').matches)
  const [value, setValue] = useState(read)
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const queries = [matchMedia('(max-width: 640px)'), matchMedia('(pointer: coarse)')]
    const change = () => setValue(read())
    for (const query of queries) query.addEventListener?.('change', change)
    return () => {
      for (const query of queries) query.removeEventListener?.('change', change)
    }
  }, [])
  return value
}

function ScreensaverCanvas({ flashMask }: { flashMask: number }) {
  const canvas = useSyncExternalStore(subscribeCanvas, getCanvasSnapshot)
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const target = ref.current
    const context = target?.getContext('2d')
    if (!target || !context) return
    const image = context.createImageData(256, 256)
    for (let index = 0; index < 65_536; index++) {
      const colour = canvas.outline[index]
        ? canvas.face
        : canvas.background[index] === 0
          ? canvas.backgroundColor
          : canvas.background[index]
      const [red, green, blue] = PALETTE[colour]?.rgb ?? PALETTE[1].rgb
      const offset = index * 4
      image.data[offset] = red
      image.data[offset + 1] = green
      image.data[offset + 2] = blue
      image.data[offset + 3] = 255
    }
    context.putImageData(image, 0, 0)
    if (flashMask) {
      context.save()
      context.strokeStyle = '#5feddf'
      context.lineWidth = 2
      for (let region = 0; region < 16; region++) {
        if ((flashMask & (1 << region)) === 0) continue
        const x = (region & 3) * 64
        const y = (region >> 2) * 64
        context.strokeRect(x + 1, y + 1, 62, 62)
      }
      context.restore()
    }
  }, [canvas, flashMask])

  return <canvas ref={ref} width={256} height={256} className="screensaver-canvas" />
}

export function ScreensaverOverlay() {
  const setting = useSyncExternalStore(subscribeScreensaverSetting, getScreensaverSetting)
  const windows = useSyncExternalStore(subscribeWindows, getWindows)
  const confirm = useSyncExternalStore(subscribeConfirm, getConfirm)
  const traces = useSyncExternalStore(subscribeTxTrace, getTxTraceSnapshot)
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const booting = useSyncExternalStore(subscribeBooting, isBooting)
  const firstRun = useSyncExternalStore(subscribeFirstRun, isFirstRunOpen)
  const floppy = useSyncExternalStore(subscribeFloppy, getFloppyRequest)
  const player = useSyncExternalStore(subscribeBlockPlayer, getBlockPlayerPlaying)
  const narrowOrTouch = useNarrowOrTouch()
  const [active, setActive] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [flashMask, setFlashMask] = useState(0)
  // Moved by writing to the element directly: no React re-render on every animation frame.
  const pictureRef = useRef<HTMLDivElement>(null)
  const lastInput = useRef(performance.now())
  const timer = useRef<number | undefined>(undefined)
  const wakeGuardUntil = useRef(0)
  const positionRef = useRef({ x: 40, y: 40, dx: 20, dy: 20, at: performance.now() })

  const modalOpen =
    Boolean(floppy) || windows.windows.some((win) => !win.minimized && Boolean(programById(win.id)?.modal))
  const transactionPending = hasRecentPendingTx(traces.traces, performance.now())
  const allowed = canStartScreensaver({
    setting,
    narrowOrTouch,
    modalOpen,
    confirmOpen: Boolean(confirm),
    transactionPending,
    blockPlayerPlaying: player,
    booting,
    firstRunOpen: firstRun,
  })

  useEffect(() => {
    // Phones and touch screens never get a screensaver, so they don't need idle tracking either.
    if (narrowOrTouch) return
    const schedule = () => {
      if (timer.current) window.clearTimeout(timer.current)
      const left = Math.max(0, WAIT_MS - (performance.now() - lastInput.current))
      timer.current = window.setTimeout(() => {
        if (!document.hidden && allowed && !document.querySelector('[role=\"dialog\"], .message-box'))
          setActive(true)
        else {
          lastInput.current = performance.now() - WAIT_MS + 5_000
          schedule()
        }
      }, left)
    }
    const input = (event: Event) => {
      lastInput.current = performance.now()
      if (active) {
        // The wake-up gesture belongs to the screensaver. Keep swallowing the tail of a pointer/touch
        // gesture after React removes the overlay, otherwise its pointerup/click can land on a button below.
        wakeGuardUntil.current = Date.now() + 600
        if (event.cancelable) event.preventDefault()
        event.stopImmediatePropagation()
      }
      setActive(false)
      setPreviewing(false)
      schedule()
    }
    const swallowWakeTail = (event: Event) => {
      if (Date.now() >= wakeGuardUntil.current) return
      if (event.cancelable) event.preventDefault()
      event.stopImmediatePropagation()
    }
    const visibility = () => {
      // Hidden tabs are not idle displays. Restart the idle clock when the page becomes visible so a
      // backgrounded tab never wakes directly into the screensaver.
      lastInput.current = performance.now()
      if (document.hidden) {
        setActive(false)
        setPreviewing(false)
      }
      schedule()
    }
    const events: Array<keyof WindowEventMap> = [
      'pointerdown',
      'pointermove',
      'keydown',
      'touchstart',
      'wheel',
    ]
    // Only block default handling while the screensaver is up; otherwise stay passive so scrolling is never delayed.
    for (const event of events)
      window.addEventListener(event, input, { capture: true, passive: !active } as AddEventListenerOptions)
    for (const event of ['pointerup', 'touchend', 'click'] as const)
      window.addEventListener(event, swallowWakeTail, { capture: true, passive: false })
    const preview = () => {
      setPreviewing(true)
      setActive(true)
    }
    window.addEventListener('r3os:preview-screensaver', preview)
    document.addEventListener('visibilitychange', visibility)
    schedule()
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
      for (const event of events)
        window.removeEventListener(event, input, { capture: true } as EventListenerOptions)
      for (const event of ['pointerup', 'touchend', 'click'] as const)
        window.removeEventListener(event, swallowWakeTail, { capture: true } as EventListenerOptions)
      window.removeEventListener('r3os:preview-screensaver', preview)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [active, allowed, narrowOrTouch])

  useEffect(() => {
    if (active && !allowed && !previewing) setActive(false)
  }, [active, allowed, previewing])

  useEffect(() => {
    if (!active) return
    let flashTimer: number | undefined
    const reduced =
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
    const stop = subscribeCanvasActivity((activity) => {
      if (reduced || activity.eventName !== 'Painted' || !activity.regionsMask) return
      setFlashMask(activity.regionsMask)
      if (flashTimer) window.clearTimeout(flashTimer)
      flashTimer = window.setTimeout(() => setFlashMask(0), 900)
    })
    return () => {
      stop()
      if (flashTimer) window.clearTimeout(flashTimer)
      setFlashMask(0)
    }
  }, [active])

  useEffect(() => {
    if (!active) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return
    let frame = 0
    const animate = (now: number) => {
      const state = positionRef.current
      const dt = Math.min(0.05, (now - state.at) / 1_000)
      state.at = now
      const size = Math.min(innerWidth, innerHeight) * 0.7
      state.x += state.dx * dt
      state.y += state.dy * dt
      if (state.x < 0 || state.x + size > innerWidth) {
        state.dx *= -1
        state.x = Math.max(0, Math.min(innerWidth - size, state.x))
      }
      if (state.y < 0 || state.y + size > innerHeight) {
        state.dy *= -1
        state.y = Math.max(0, Math.min(innerHeight - size, state.y))
      }
      const picture = pictureRef.current
      if (picture) {
        picture.style.left = `${state.x}px`
        picture.style.top = `${state.y}px`
      }
      frame = requestAnimationFrame(animate)
    }
    positionRef.current.at = performance.now()
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [active])

  if (!active) return null
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  return (
    <div
      className="screensaver-overlay"
      role="presentation"
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        lastInput.current = performance.now()
        setActive(false)
        setPreviewing(false)
      }}
    >
      <div
        ref={pictureRef}
        className={`screensaver-picture ${reduced ? 'static' : ''}`}
        style={reduced ? undefined : { left: positionRef.current.x, top: positionRef.current.y }}
      >
        <ScreensaverCanvas flashMask={flashMask} />
      </div>
      <span className="screensaver-block">block #{block.block ? block.block.toString() : '—'}</span>
    </div>
  )
}
