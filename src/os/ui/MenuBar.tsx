import { useEffect, useRef, useState } from 'react'
import { playSound } from '../sound'
import { useWindowActive } from '../Window'

export interface MenuItem {
  label: string
  disabled?: boolean
  disabledReason?: string
  action?: () => void
  children?: MenuItem[]
}

function marked(label: string) {
  return (
    <>
      <u>{label[0]}</u>
      {label.slice(1)}
    </>
  )
}

function focusElement(element: Element | null | undefined) {
  if (element instanceof HTMLElement) element.focus()
}

export function MenuBar({
  menus,
  onOpen,
}: {
  menus: { label: string; items: MenuItem[] }[]
  onOpen?: (label: string) => void
}) {
  const active = useWindowActive()
  const [open, setOpen] = useState<string>()
  const root = useRef<HTMLDivElement>(null)

  const choose = (label?: string) => {
    setOpen(label)
    if (label) onOpen?.(label)
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!active) return
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        const menu = menus.find((candidate) => candidate.label[0].toLowerCase() === event.key.toLowerCase())
        if (menu) {
          event.preventDefault()
          choose(menu.label)
          playSound('select')
        }
      }
      if (event.key === 'Escape') choose(undefined)
      if (event.key === 'ArrowDown' && open) {
        focusElement(root.current?.querySelector(`[data-menu="${open}"] [role="menuitem"]`))
      }
    }
    const outside = (event: PointerEvent) => {
      if (open && !root.current?.contains(event.target as Node)) choose(undefined)
    }
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', outside)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerdown', outside)
    }
  }, [active, menus, open])

  return (
    <div ref={root} role="menubar" className="menu-bar">
      {menus.map((menu) => (
        <div key={menu.label} className="menu-root" onMouseEnter={() => open && choose(menu.label)}>
          <button
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === menu.label}
            onClick={() => {
              playSound('select')
              choose(open === menu.label ? undefined : menu.label)
            }}
          >
            {marked(menu.label)}
          </button>
          {open === menu.label && (
            <div role="menu" data-menu={menu.label} className="menu-dropdown raised">
              {menu.items.map((item, index) => (
                <button
                  key={`${item.label}-${index}`}
                  role="menuitem"
                  disabled={item.disabled}
                  title={item.disabled ? (item.disabledReason ?? item.label) : undefined}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      focusElement(
                        event.currentTarget.nextElementSibling ??
                          event.currentTarget.parentElement?.firstElementChild,
                      )
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault()
                      focusElement(
                        event.currentTarget.previousElementSibling ??
                          event.currentTarget.parentElement?.lastElementChild,
                      )
                    }
                  }}
                  onClick={() => {
                    if (item.disabled) return
                    item.action?.()
                    choose(undefined)
                    playSound('select')
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
