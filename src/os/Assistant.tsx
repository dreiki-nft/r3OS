import { useEffect, useState, useSyncExternalStore } from 'react'
import { getAssistantTip, setAssistantTip, subscribeAssistant } from './assistantStore'
import { getBalloons, subscribeBalloons } from './balloons'
import { playSound } from './sound'
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
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem('r3os.assistantHidden') === '1'
    } catch {
      return false
    }
  })
  const [tipIndex, setTipIndex] = useState(0)

  useEffect(() => {
    const hide = () => {
      setHidden(true)
      try {
        localStorage.setItem('r3os.assistantHidden', '1')
      } catch {
        // Storage can be blocked.
      }
    }
    window.addEventListener('r3os-hide-assistant', hide)
    return () => window.removeEventListener('r3os-hide-assistant', hide)
  }, [])

  if (hidden) return null
  const text = eventTip ?? tips[tipIndex]
  return (
    <aside className="assistant">
      <button
        className="assistant-hide"
        aria-label="Hide assistant"
        onClick={() => {
          setHidden(true)
          try {
            localStorage.setItem('r3os.assistantHidden', '1')
          } catch {
            // Storage can be blocked.
          }
        }}
      >
        ×
      </button>
      <button
        className="assistant-pic raised"
        onClick={() => {
          setAssistantTip(undefined)
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
