import { useEffect } from 'react'
import { playSound } from './sound'

export function StormScreen({ start, onDismiss }: { start: bigint; onDismiss: () => void }) {
  useEffect(() => {
    playSound('storm')
    const dismiss = () => onDismiss()
    window.addEventListener('keydown', dismiss, { once: true })
    return () => window.removeEventListener('keydown', dismiss)
  }, [onDismiss])

  return (
    <button className="storm-screen" onClick={onDismiss}>
      <div>
        <h1>r3OS</h1>
        <p>
          A DF1 storm has started at block {start.toString()}. For the next 600 blocks (about 3 minutes) every
          fresh pixel can glitch at 200%.
        </p>
        <p>
          * solo painters get glitched too
          <br />* frames minted now are marked STORM forever
          <br />* storm paints count toward STORM CHASER and STORM REGULAR
        </p>
        <strong>Press any key to keep painting _</strong>
      </div>
    </button>
  )
}
