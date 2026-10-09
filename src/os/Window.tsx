import { createContext, useContext, useRef, type PointerEvent, type ReactNode } from 'react'
import type { IconName } from './icons'
import type { WindowControls } from './programs'
import { playSound } from './sound'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { Icon } from './ui/Icon'
import {
  closeWindow,
  focusWindow,
  maximizeWindow,
  minimizeWindow,
  moveWindow,
  resizeWindow,
  setAlwaysOnTop,
  shouldStartTitleDrag,
  windowZIndex,
  type WindowState,
} from './windows'
import { isPhoneScreen } from './phone'

const WindowActiveContext = createContext(false)
export const useWindowActive = () => useContext(WindowActiveContext)

export function Window({
  win,
  title,
  icon,
  children,
  active,
  controls = 'full',
  onHelp,
  pinToggle = false,
}: {
  win: WindowState
  title: string
  icon: IconName
  children: ReactNode
  active: boolean
  controls?: WindowControls
  onHelp?: () => void
  pinToggle?: boolean
}) {
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const sizing = useRef<{ x: number; y: number; w: number; h: number } | null>(null)
  if (win.minimized) return null
  const mobile = isPhoneScreen()
  const maximizable = controls === 'full'
  const minimizable = controls === 'full' || controls === 'min-close'
  const style =
    win.maximized || mobile
      ? { left: 0, top: 0, width: '100%', height: 'calc(100% - 48px)', zIndex: windowZIndex(win) }
      : {
          left: win.rect.x,
          top: win.rect.y,
          width: win.rect.width,
          height: win.rect.height,
          zIndex: windowZIndex(win),
        }

  const clearDrag = () => {
    drag.current = null
  }
  const clearResize = () => {
    sizing.current = null
  }

  const down = (event: PointerEvent<HTMLElement>) => {
    focusWindow(win.id)
    const targetIsButton = Boolean((event.target as HTMLElement).closest('button'))
    if (!shouldStartTitleDrag(targetIsButton, win.maximized, mobile)) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      ox: win.rect.x,
      oy: win.rect.y,
    }
  }

  return (
    <WindowActiveContext.Provider value={active}>
      <section
        className={`window os-window ${active ? 'active' : ''}`}
        style={style}
        onPointerDown={() => focusWindow(win.id)}
      >
        <header
          className="titlebar"
          onPointerDown={down}
          onPointerMove={(event) => {
            if (!drag.current) return
            moveWindow(
              win.id,
              drag.current.ox + event.clientX - drag.current.x,
              drag.current.oy + event.clientY - drag.current.y,
            )
          }}
          onPointerUp={clearDrag}
          onPointerCancel={clearDrag}
          onLostPointerCapture={clearDrag}
          onDoubleClick={(event) => {
            if (!maximizable || (event.target as HTMLElement).closest('button')) return
            maximizeWindow(win.id)
          }}
        >
          <Icon name={icon} size={20} />
          <strong>{title}</strong>
          <span className="titlebar-spacer" />
          {pinToggle && (
            <button
              aria-label={win.alwaysOnTop ? 'Unpin from top' : 'Pin on top'}
              aria-pressed={Boolean(win.alwaysOnTop)}
              title={win.alwaysOnTop ? 'Unpin from top' : 'Pin on top'}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                playSound('select')
                setAlwaysOnTop(win.id, !win.alwaysOnTop)
              }}
            >
              {win.alwaysOnTop ? '◆' : '◇'}
            </button>
          )}
          {controls === 'help-close' && (
            <button
              aria-label="Help"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                playSound('select')
                onHelp?.()
              }}
            >
              ?
            </button>
          )}
          {minimizable && (
            <button
              aria-label="Minimize"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                playSound('select')
                minimizeWindow(win.id)
              }}
            >
              _
            </button>
          )}
          {maximizable && (
            <button
              aria-label="Maximize"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => {
                playSound('select')
                maximizeWindow(win.id)
              }}
            >
              □
            </button>
          )}
          <button
            aria-label="Close"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              playSound('cancel')
              closeWindow(win.id)
            }}
          >
            ×
          </button>
        </header>
        <div className="window-content">
          <ErrorBoundary onClose={() => closeWindow(win.id)}>{children}</ErrorBoundary>
        </div>
        {!mobile && !win.maximized && controls === 'full' && (
          <div
            className="resize-grip"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              sizing.current = {
                x: event.clientX,
                y: event.clientY,
                w: win.rect.width,
                h: win.rect.height,
              }
            }}
            onPointerMove={(event) => {
              if (!sizing.current) return
              resizeWindow(
                win.id,
                sizing.current.w + event.clientX - sizing.current.x,
                sizing.current.h + event.clientY - sizing.current.y,
              )
            }}
            onPointerUp={clearResize}
            onPointerCancel={clearResize}
            onLostPointerCapture={clearResize}
          />
        )}
      </section>
    </WindowActiveContext.Provider>
  )
}
