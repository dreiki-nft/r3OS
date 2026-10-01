import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { clampMenuPosition, type ShellAction, type ShellMenuItem } from './shellMenus'

/** Other shell menus (Start menu, a new context menu) ask open context menus to close with this event. */
export const CLOSE_MENUS_EVENT = 'r3os:close-menus'

export function closeShellMenus() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CLOSE_MENUS_EVENT))
}

/** A tiny Win98 popup menu at a viewport point, clamped on screen. */
export function ContextMenu({
  x,
  y,
  items,
  label,
  onAction,
  onClose,
}: {
  x: number
  y: number
  items: ShellMenuItem[]
  label: string
  onAction: (action: ShellAction) => void
  onClose: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y, maxHeight: 0, ready: false })

  useLayoutEffect(() => {
    const node = root.current
    if (!node) return
    const placed = clampMenuPosition(
      { x, y },
      { width: node.offsetWidth, height: node.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    )
    setPosition({ ...placed, ready: true })
    node.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })
  }, [x, y])

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose()
    }
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', key)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    window.addEventListener(CLOSE_MENUS_EVENT, onClose)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
      window.removeEventListener(CLOSE_MENUS_EVENT, onClose)
    }
  }, [onClose])

  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const entries = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const index = entries.indexOf(document.activeElement as HTMLElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    entries[(index + step + entries.length) % entries.length]?.focus()
  }

  return (
    <div
      ref={root}
      role="menu"
      aria-label={label}
      className="shell-context-menu raised"
      style={{
        left: position.left,
        top: position.top,
        maxHeight: position.maxHeight || undefined,
        visibility: position.ready ? 'visible' : 'hidden',
      }}
      onKeyDown={keyboard}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) =>
        item.kind === 'separator' ? (
          <hr key={item.id} role="separator" />
        ) : (
          <button
            key={item.id}
            role="menuitem"
            className={item.default ? 'default' : undefined}
            onClick={() => {
              onClose()
              onAction(item.action)
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  )
}
