import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import type { IconName } from '../icons'
import { playSound } from '../sound'
import { Button } from './Button'
import { Icon } from './Icon'

export function MessageBox({
  kind = 'info',
  title,
  message,
  details,
  children,
  onClose,
  onDefault,
  onCancel,
  defaultLabel = 'OK',
  cancelLabel = 'Cancel',
}: {
  kind?: 'info' | 'warning' | 'error'
  title: string
  message?: string
  details?: string
  children?: ReactNode
  onClose: () => void
  onDefault?: () => void
  onCancel?: () => void
  defaultLabel?: string
  cancelLabel?: string
}) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (kind === 'error') playSound('error')
  }, [kind])

  const close = (cancelled = false) => {
    if (cancelled) onCancel?.()
    onClose()
  }

  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      playSound('cancel')
      close(true)
      return
    }
    if (event.key === 'Enter') {
      const target = event.target as HTMLElement
      if (target.closest('button, a, input, select, textarea')) return
      event.preventDefault()
      onDefault?.()
      onClose()
      return
    }
    if (event.key === 'Tab') {
      const focusable = [
        ...(root.current?.querySelectorAll<HTMLElement>('button, a, input, [tabindex="0"]') ?? []),
      ]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  return (
    <div className="modal-shade">
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="message-box window"
        onKeyDown={keyboard}
      >
        <header className="titlebar">
          <strong>{title}</strong>
          <span className="titlebar-spacer" />
          <button
            aria-label="Close"
            onClick={() => {
              playSound('cancel')
              close(true)
            }}
          >
            ×
          </button>
        </header>
        <div className="message-box-content">
          {message != null && (
            <div className="message-body">
              <Icon
                name={(kind === 'error' ? 'error' : kind === 'warning' ? 'warning' : 'info') as IconName}
                size={36}
                colour={kind === 'error' ? '#C52020' : kind === 'warning' ? '#FEC343' : '#5FEDDF'}
              />
              <div>
                <p>{message}</p>
                {details && (
                  <details>
                    <summary>Details &gt;&gt;</summary>
                    <pre>{details}</pre>
                  </details>
                )}
              </div>
            </div>
          )}
          {children}
          <div className="dialog-actions">
            <Button
              autoFocus
              primary
              onClick={() => {
                onDefault?.()
                onClose()
                playSound('confirm')
              }}
            >
              {defaultLabel}
            </Button>
            {onCancel && <Button onClick={() => close(true)}>{cancelLabel}</Button>}
          </div>
        </div>
      </div>
    </div>
  )
}
