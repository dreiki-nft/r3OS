import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { chainName, config } from '../chain/config'
import { observedBlockMs, pushBlockSample, type BlockSample } from '../monadhw/explore'
import { BOOT_TIMING, POST_WAITS, postLines, rememberBoot, setBooting, shouldBoot } from './bootState'
import { openProgram } from './programs'
import { playSound } from './sound'

type Phase = 'post' | 'splash' | 'fade' | 'done'

function session() {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}

// Decided at load so the welcome dialog and assistant wait from the very first render.
if (shouldBoot(session())) setBooting(true)

const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Power-on: BIOS lines (real chain facts), the r3tardOS 98 splash, then the desktop. Once per tab session,
 * any key or click skips it, DEL opens "SETUP" (DXDIAG). It only reads the app's shared block stream.
 */
export function BootScreen() {
  const [phase, setPhase] = useState<Phase>(() =>
    shouldBoot(session()) ? (reducedMotion() ? 'splash' : 'post') : 'done',
  )
  const [shown, setShown] = useState(0)
  const [samples, setSamples] = useState<BlockSample[]>([])
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const skipped = useRef(false)
  const waitStarted = useRef<Record<number, number>>({})
  const live = useRef({ block: 0n, samples: [] as BlockSample[] })
  const [tick, setTick] = useState(0)

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
    if (phase === 'done') rememberBoot(session())
  }, [phase])
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

  // Splash and fade run on their own clock: new blocks must not restart them.
  useEffect(() => {
    if (phase === 'splash') {
      const timer = window.setTimeout(() => setPhase('fade'), reducedMotion() ? 900 : BOOT_TIMING.splashMs)
      return () => window.clearTimeout(timer)
    }
    if (phase === 'fade') {
      const timer = window.setTimeout(() => {
        setPhase('done')
        // Audible only after a click or key (browser autoplay rules), like the Windows startup chime.
        if (skipped.current) playSound('system-initiate')
      }, BOOT_TIMING.fadeMs)
      return () => window.clearTimeout(timer)
    }
  }, [phase])

  useEffect(() => {
    if (phase === 'done') return
    const skip = () => {
      skipped.current = true
      setPhase((current) => (current === 'done' ? current : 'fade'))
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
      aria-label="r3tardOS is starting"
      onPointerDown={() => {
        skipped.current = true
        setPhase('fade')
      }}
    >
      {phase === 'post' ? (
        <pre className="boot-post" aria-live="off">
          {lines.slice(0, shown).join('\n')}
          <span className="boot-cursor">_</span>
        </pre>
      ) : (
        <div className="boot-splash">
          <div className="boot-mark">
            <img src="/os/brand/logo.png" alt="" width={168} height={168} />
            <div>
              <b>
                r3tardOS<sup>98</sup>
              </b>
              <span>a shared computer on Monad</span>
            </div>
          </div>
          <div className="boot-bar" aria-hidden="true" />
        </div>
      )}
    </div>
  )
}
