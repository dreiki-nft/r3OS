import { useEffect, useRef, useState } from 'react'
import type { BalloonNotice } from '../balloons'
import { dismissBalloon } from '../balloons'
import { playSound } from '../sound'
import { Button } from './Button'
import { Icon } from './Icon'

export function Balloon({ notice }: { notice: BalloonNotice }) {
  const closeRef = useRef(() => dismissBalloon(notice.id))
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    closeRef.current = () => dismissBalloon(notice.id)
  }, [notice.id])

  useEffect(() => {
    if (notice.sound !== false) playSound(notice.sound ?? 'cute-bubble')
  }, [notice.id, notice.sound])

  useEffect(() => {
    if (hovered || notice.sticky) return
    const timer = window.setTimeout(() => closeRef.current(), 8_000)
    return () => window.clearTimeout(timer)
  }, [hovered, notice.id, notice.sticky])

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
        {notice.actions?.length ? (
          <div className="balloon-actions">
            {notice.actions.map((action, index) => (
              <Button
                key={action.label}
                primary={index === 0}
                onClick={() => {
                  dismissBalloon(notice.id)
                  action.run()
                }}
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
