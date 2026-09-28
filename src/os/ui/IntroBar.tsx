import { useEffect, useRef, useState } from 'react'
import { Button } from './Button'
import { Icon } from './Icon'

export type IntroBarAction = 'toggle' | 'escape' | 'outside'
export function nextIntroOpen(open: boolean, action: IntroBarAction) {
  return action === 'toggle' ? !open : false
}

export function IntroBar({
  lead,
  monad,
  rules,
  finalLine,
}: {
  lead: string
  monad: string
  rules: readonly string[]
  finalLine?: string
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen((value) => nextIntroOpen(value, 'escape'))
    }
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen((value) => nextIntroOpen(value, 'outside'))
    }
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', outside)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerdown', outside)
    }
  }, [open])

  return (
    <div ref={root} className="intro-bar">
      <Icon name="info" size={24} colour="#5FEDDF" />
      <div className="intro-copy">
        <b>{lead}</b>
        <span>
          <strong>on monad · </strong>
          {monad}
        </span>
      </div>
      <Button aria-expanded={open} onClick={() => setOpen((value) => nextIntroOpen(value, 'toggle'))}>
        How it works {open ? '▴' : '▾'}
      </Button>
      {open && (
        <div className="intro-popover raised">
          <b>How it works</b>
          <ol>
            {rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ol>
          {finalLine && <p>{finalLine}</p>}
        </div>
      )}
    </div>
  )
}
