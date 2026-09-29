import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  ASSISTANT_AUTO_HIDE_MS,
  assistantOverlapsWindows,
  getAssistantTip,
  setAssistantTip,
  subscribeAssistant,
} from './assistantStore'
import { getBalloons, subscribeBalloons } from './balloons'
import { playSound } from './sound'
import { getWindows, subscribeWindows } from './windows'
import { SafeImage } from './ui/SafeImage'

const tips = [
  'click an icon twice. yes, twice. computers used to make you earn it.',
  'paint blank pixels if you want cheap gas. overwriting dry art costs more.',
  'frames are snapshots. save one after you actually paint something.',
  'the pass grants absolutely nothing. naturally, everyone will want one.',
]

export function Assistant() {
  const eventTip = useSyncExternalStore(subscribeAssistant, getAssistantTip)
  const balloons = useSyncExternalStore(subscribeBalloons, getBalloons)
  const windows = useSyncExternalStore(subscribeWindows, getWindows)
  const [manualHidden, setManualHidden] = useState(() => {
    try {
      return localStorage.getItem('r3os.assistantHidden') === '1'
    } catch {
      return false
    }
  })
  const [autoHidden, setAutoHidden] = useState(false)
  const [tipIndex, setTipIndex] = useState(0)
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

  const overlapped = assistantOverlapsWindows(windows.windows, viewport.width, viewport.height)
  if (manualHidden || autoHidden || overlapped) return null
  const text = eventTip ?? tips[tipIndex]
  return (
    <aside className="assistant">
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
