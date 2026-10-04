import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { chainName, config } from '../chain/config'
import { recordPerf } from '../chain/perf'
import { observedBlockMs, pushBlockSample, type BlockSample } from '../monadhw/explore'
import { BOOT_TIMING, POST_WAITS, bootMode, postLines, rememberBoot, setBooting, type BootMode } from './bootState'
import { openProgram } from './programs'
import { playSound } from './sound'
import { FIRST_RUN_KEY } from './firstRunState'
import {
  bootPrefetchProgress,
  bootPrefetchReady,
  bootPrefetchRows,
  getBootPrefetchSnapshot,
  subscribeBootPrefetch,
} from './bootPrefetch'

type Phase = 'post' | 'splash' | 'fade' | 'done'

function session() {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}

function local() {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function resolvedBootMode(): BootMode {
  let firstRunDone = false
  try {
    firstRunDone = local()?.getItem(FIRST_RUN_KEY) === '1'
  } catch {
    firstRunDone = false
  }
  return bootMode(session(), local(), firstRunDone)
}

// Decided at load so the welcome dialog and assistant wait from the very first render.
const bootAtLoad = resolvedBootMode()
if (bootAtLoad !== 'none') setBooting(true)

const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Power-on: BIOS lines (real chain facts), the r3OS 98 splash, then the desktop. Once per tab session,
 * input can skip the cosmetic POST, but the splash still honors critical readiness / the hard cap.
 * DEL opens "SETUP" (DXDIAG) after startup. It only reads the app's shared block stream.
 */
export function BootScreen() {
  const [mode] = useState<BootMode>(() => bootAtLoad)
  const [phase, setPhase] = useState<Phase>(() =>
    mode === 'none' ? 'done' : mode === 'splash' || reducedMotion() ? 'splash' : 'post',
  )
  const [shown, setShown] = useState(0)
  const [samples, setSamples] = useState<BlockSample[]>([])
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const skipped = useRef(false)
  const waitStarted = useRef<Record<number, number>>({})
  const live = useRef({ block: 0n, samples: [] as BlockSample[] })
  const [tick, setTick] = useState(0)
  const prefetch = useSyncExternalStore(subscribeBootPrefetch, getBootPrefetchSnapshot)
  const bootStartedAt = useRef(typeof performance === 'undefined' ? Date.now() : performance.now())
  const splashStartedAt = useRef<number | undefined>(undefined)
  const bootTotalRecorded = useRef(false)

  live.current = { block: block.block, samples }
  const lines = postLines({
    chainName,
    chainId: config.chainId,
    block: block.block,
    // The first sample is the app's initial header read, not an arrival: measure from the arrivals after it
    // (two gaps at least), so the number is the real cadence.
    blockMs: samples.length >= 4 ? observedBlockMs(samples.slice(0, -1)) : undefined,
    // Never claim "no signal" during a 3 s boot: an RPC that hasn't answered yet just reads "searching…".
    offline: false,
    demo: config.demo,
  })

  useEffect(() => {
    setBooting(phase !== 'done')
    if (phase === 'done') rememberBoot(session(), local(), mode)
  }, [phase, mode])
  useEffect(() => () => setBooting(false), [])

  // Measure the block clock from the blocks this browser actually sees during the BIOS screen.
  useEffect(() => {
    if (phase !== 'post' || block.block === 0n) return
    setSamples((current) => pushBlockSample(current, { block: block.block, at: performance.now() }))
  }, [block.block, phase])

  useEffect(() => {
    if (phase === 'post') {
      if (shown < lines.length) {
        const wait = POST_WAITS[shown]
        const ready =
          !wait ||
          config.demo ||
          (wait.until === 'block' ? live.current.block > 0n : live.current.samples.length >= 4)
        if (!ready) {
          // Hold this line until the chain answers, but never longer than the cap.
          waitStarted.current[shown] ??= performance.now()
          const left = wait.maxMs - (performance.now() - waitStarted.current[shown])
          if (left > 0) {
            const timer = window.setTimeout(() => setTick((value) => value + 1), Math.min(left, 100))
            return () => window.clearTimeout(timer)
          }
        }
        const timer = window.setTimeout(() => setShown((value) => value + 1), BOOT_TIMING.postLineMs)
        return () => window.clearTimeout(timer)
      }
      const timer = window.setTimeout(() => setPhase('splash'), BOOT_TIMING.postHoldMs)
      return () => window.clearTimeout(timer)
    }
    // Blocks are read through a ref: a new block every ~0.3 s must not restart these timers.
  }, [phase, shown, lines.length, tick])

  // Splash and fade run on their own clock: new blocks must not restart them. The splash has a short
  // cosmetic minimum, then stays up only while critical prefetch work is still useful. A hard cap keeps
  // a broken RPC or slow connection from trapping the user behind startup for more than ~10 seconds.
  useEffect(() => {
    if (phase === 'splash') {
      const current = typeof performance === 'undefined' ? Date.now() : performance.now()
      splashStartedAt.current ??= current
      const minimum =
        mode === 'splash' ? BOOT_TIMING.returningSplashMs : reducedMotion() ? 900 : BOOT_TIMING.splashMs
      const splashElapsed = current - splashStartedAt.current
      const bootElapsed = current - bootStartedAt.current
      const minimumLeft = minimum - splashElapsed
      const capLeft = BOOT_TIMING.maxTotalMs - BOOT_TIMING.fadeMs - bootElapsed

      if (minimumLeft <= 0 && (bootPrefetchReady(prefetch) || capLeft <= 0)) {
        setPhase('fade')
        return
      }

      const wait = minimumLeft > 0 ? Math.min(minimumLeft, Math.max(1, capLeft)) : Math.max(1, capLeft)
      const timer = window.setTimeout(() => setTick((value) => value + 1), wait)
      return () => window.clearTimeout(timer)
    }
    splashStartedAt.current = undefined
    if (phase === 'fade') {
      const timer = window.setTimeout(() => {
        if (!bootTotalRecorded.current && mode !== 'none') {
          bootTotalRecorded.current = true
          const current = typeof performance === 'undefined' ? Date.now() : performance.now()
          recordPerf('boot-prefetch', 'boot-total', current - bootStartedAt.current)
        }
        setPhase('done')
        // Audible only after a click or key (browser autoplay rules), like the Windows startup chime.
        if (skipped.current) playSound('system-initiate')
      }, BOOT_TIMING.fadeMs)
      return () => window.clearTimeout(timer)
    }
  }, [phase, mode, prefetch.version, tick])

  useEffect(() => {
    if (phase === 'done') return
    const skip = () => {
      skipped.current = true
      setPhase((current) => {
        if (current === 'post') return 'splash'
        if (current === 'splash' && bootPrefetchReady(getBootPrefetchSnapshot())) return 'fade'
        return current
      })
    }
    const onKey = (event: KeyboardEvent) => {
      // Keep the key from also pressing whatever sits under the boot screen (e.g. the welcome buttons).
      event.preventDefault()
      if (event.key === 'Delete' && phase === 'post') {
        skip()
        window.setTimeout(() => openProgram('dxdiag'), BOOT_TIMING.fadeMs + 50)
        return
      }
      skip()
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [phase])

  if (phase === 'done') return null

  return (
    <div
      className={`boot-screen phase-${phase}`}
      role="presentation"
      aria-label="r3OS is starting"
      onPointerDown={() => {
        skipped.current = true
        setPhase((current) => {
          if (current === 'post') return 'splash'
          if (current === 'splash' && bootPrefetchReady(getBootPrefetchSnapshot())) return 'fade'
          return current
        })
      }}
    >
      {phase === 'post' ? (
        <pre className="boot-post" aria-live="off">
          {lines.slice(0, shown).join('\n')}
          <span className="boot-cursor">_</span>
        </pre>
      ) : (
        <div className="boot-splash">
          <div className="boot-splash-inner">
            <div className="boot-mark">
              <img src="/os/brand/logo.png" alt="" width={168} height={168} />
              <div>
                <b>
                  r3OS<sup>98</sup>
                </b>
                <span>an operating system for Monad</span>
              </div>
            </div>
            <div className="boot-prefetch" aria-live="off">
              <div className="boot-prefetch-head">
                <b>Starting system</b>
                <span>
                  {bootPrefetchProgress(prefetch).done}/{bootPrefetchProgress(prefetch).total}
                </span>
              </div>
              {bootPrefetchRows(prefetch).map((task) => (
                <div className={`boot-prefetch-row state-${task.state}`} key={task.id}>
                  <span className="boot-prefetch-state" aria-hidden="true">
                    {task.state === 'done'
                      ? 'OK'
                      : task.state === 'error'
                        ? '!!'
                        : task.state === 'skipped'
                          ? '--'
                          : '..'}
                  </span>
                  <span>{task.label}</span>
                  <small>{task.detail ?? ''}</small>
                </div>
              ))}
            </div>
          </div>
          <div className="boot-bar" aria-hidden="true" />
        </div>
      )}
    </div>
  )
}
