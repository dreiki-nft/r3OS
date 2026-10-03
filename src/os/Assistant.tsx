import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  ASSISTANT_AUTO_HIDE_MS,
  assistantOverlapsWindows,
  getAssistantTip,
  setAssistantTip,
  subscribeAssistant,
} from './assistantStore'
import { getBalloons, subscribeBalloons } from './balloons'
import { isBooting, subscribeBooting } from './bootState'
import { isFirstRunOpen, subscribeFirstRun } from './firstRunState'
import { playSound } from './sound'
import { getWindows, subscribeWindows } from './windows'
import { SafeImage } from './ui/SafeImage'

const tips = [
  'click an icon twice. yes, twice. computers used to make you earn it.',
  'paint blank pixels if you want cheap gas. overwriting dry art costs more.',
  'frames are snapshots. save one after you actually paint something: Paint › File › Save frame….',
  'the pass grants absolutely nothing. naturally, everyone will want one.',
  'lost? Start › Help explains every program in plain words.',
  'Quests checks the chain for you. reach a goal, press Claim, brag.',
  'Block Camera photographs a block. one shot per wallet per block, so be quick.',
  'storms hit every 200,000 blocks. paint during one and your Pass remembers.',
  'got frames you hate? the Recycle Bin takes them. forever.',
]

// Each visit starts on the next tip, so returning users don't get "click an icon twice" every time.
const TIP_KEY = 'r3os.assistantTip'

function nextVisitTip() {
  try {
    const stored = Number(localStorage.getItem(TIP_KEY) ?? '0')
    const index = Number.isInteger(stored) && stored >= 0 ? stored % tips.length : 0
    localStorage.setItem(TIP_KEY, String((index + 1) % tips.length))
    return index
  } catch {
    return 0
  }
}

export function Assistant() {
  const eventTip = useSyncExternalStore(subscribeAssistant, getAssistantTip)
  const balloons = useSyncExternalStore(subscribeBalloons, getBalloons)
  const windows = useSyncExternalStore(subscribeWindows, getWindows)
  const firstRunOpen = useSyncExternalStore(subscribeFirstRun, isFirstRunOpen)
  const booting = useSyncExternalStore(subscribeBooting, isBooting)
  const [manualHidden, setManualHidden] = useState(() => {
    try {
      return localStorage.getItem('r3os.assistantHidden') === '1'
    } catch {
      return false
    }
  })
  const [autoHidden, setAutoHidden] = useState(false)
  const [dozing, setDozing] = useState(false)
  const [hopping, setHopping] = useState(false)
  const [tipIndex, setTipIndex] = useState(nextVisitTip)
  const [viewport, setViewport] = useState(() => ({
    width: typeof innerWidth === 'number' ? innerWidth : 1_280,
    height: typeof innerHeight === 'number' ? innerHeight : 800,
  }))

  useEffect(() => {
    const hide = () => {
      setManualHidden(true)
      try {
        localStorage.setItem('r3os.assistantHidden', '1')
      } catch {
        // Storage can be blocked.
      }
    }
    const show = () => {
      setManualHidden(false)
      setAutoHidden(false)
      try {
        localStorage.removeItem('r3os.assistantHidden')
      } catch {
        // Storage can be blocked.
      }
    }
    window.addEventListener('r3os-hide-assistant', hide)
    window.addEventListener('r3os-show-assistant', show)
    return () => {
      window.removeEventListener('r3os-hide-assistant', hide)
      window.removeEventListener('r3os-show-assistant', show)
    }
  }, [])

  useEffect(() => {
    const resize = () => setViewport({ width: innerWidth, height: innerHeight })
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    if (manualHidden) return
    setAutoHidden(false)
    const timer = window.setTimeout(() => setAutoHidden(true), ASSISTANT_AUTO_HIDE_MS)
    return () => window.clearTimeout(timer)
  }, [eventTip, tipIndex, manualHidden])

  useEffect(() => {
    let timer: number | undefined
    const arm = () => {
      setDozing(false)
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => setDozing(true), 120_000)
    }
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'pointermove', 'keydown', 'touchstart']
    for (const event of events) window.addEventListener(event, arm, { passive: true })
    arm()
    return () => {
      if (timer) window.clearTimeout(timer)
      for (const event of events) window.removeEventListener(event, arm)
    }
  }, [])

  useEffect(() => {
    if (eventTip) setDozing(false)
  }, [eventTip])

  useEffect(() => {
    let timer: number | undefined
    const hop = () => {
      setHopping(true)
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => setHopping(false), 650)
    }
    window.addEventListener('r3os:assistant-hop', hop)
    return () => {
      window.removeEventListener('r3os:assistant-hop', hop)
      if (timer) window.clearTimeout(timer)
    }
  }, [])

  const overlapped = assistantOverlapsWindows(windows.windows, viewport.width, viewport.height)
  if (manualHidden || (autoHidden && !dozing) || overlapped || firstRunOpen || booting) return null
  const text = dozing ? 'zzz' : (eventTip ?? tips[tipIndex])
  return (
    <aside className={`assistant ${dozing ? 'dozing' : ''} ${hopping ? 'hopping' : ''}`}>
      <button
        className="assistant-hide"
        aria-label="Hide assistant"
        onClick={() => window.dispatchEvent(new Event('r3os-hide-assistant'))}
      >
        ×
      </button>
      <button
        className="assistant-pic raised"
        onClick={() => {
          setAssistantTip(undefined)
          setAutoHidden(false)
          setTipIndex((tipIndex + 1) % tips.length)
          playSound('text')
        }}
      >
        <SafeImage src="/os/brand/assistant.webp" alt="r3tards assistant" width={104} height={104} />
      </button>
      {balloons.length === 0 && <div className="assistant-bubble">{text}</div>}
    </aside>
  )
}
