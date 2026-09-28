import { useEffect, useRef, useState } from 'react'
import type { BalloonNotice } from '../balloons'
import { dismissBalloon } from '../balloons'
import { playSound } from '../sound'
import { Icon } from './Icon'

export function Balloon({ notice }: { notice: BalloonNotice }) {
  const closeRef = useRef(() => dismissBalloon(notice.id))
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    closeRef.current = () => dismissBalloon(notice.id)
  }, [notice.id])

  useEffect(() => {
    playSound('cute-bubble')
  }, [notice.id])

  useEffect(() => {
    if (hovered) return
    const timer = window.setTimeout(() => closeRef.current(), 8_000)
    return () => window.clearTimeout(timer)
  }, [hovered, notice.id])

  return (
    <div className="balloon" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button
        aria-label="Close balloon"
        onClick={() => {
          playSound('cancel')
          dismissBalloon(notice.id)
        }}
      >
        ×
      </button>
      <Icon name={notice.icon ?? 'info'} size={24} />
      <div>
        <b>{notice.title}</b>
        <div className="balloon-body">
          {notice.body}
          {notice.href && (
            <>
              {' · '}
              <a
                href={notice.href}
                target={notice.href.startsWith('#/') ? undefined : '_blank'}
                rel={notice.href.startsWith('#/') ? undefined : 'noreferrer'}
              >
                {notice.hrefLabel ?? 'open'}
              </a>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
