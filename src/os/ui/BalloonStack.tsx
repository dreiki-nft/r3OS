import { useSyncExternalStore } from 'react'
import { getBalloons, subscribeBalloons } from '../balloons'
import { Balloon } from './Balloon'

export function BalloonStack() {
  const notices = useSyncExternalStore(subscribeBalloons, getBalloons)
  return (
    <div className="balloon-stack" aria-live="polite">
      {notices.map((notice) => (
        <Balloon key={notice.id} notice={notice} />
      ))}
    </div>
  )
}
