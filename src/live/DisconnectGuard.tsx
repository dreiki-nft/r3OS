import { useSyncExternalStore } from 'react'
import { Button } from '../os/ui/Button'
import { Icon } from '../os/ui/Icon'
import { playSound } from '../os/sound'
import {
  cancelDisconnect,
  disconnectAnyway,
  endAndDisconnect,
  getDisconnectGuard,
  subscribeDisconnectGuard,
} from './disconnectGuardStore'
import { formatBurnerBalance } from './liveStore'

/** The "Live Mode is still on" dialog shown before disconnecting (src/live/disconnectGuardStore.ts). Mounted once. */
export function DisconnectGuard() {
  const guard = useSyncExternalStore(subscribeDisconnectGuard, getDisconnectGuard)
  if (!guard) return null
  const amount = formatBurnerBalance(guard.balance)
  const active = guard.mode === 'active'
  return (
    <div className="modal-shade">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Live Mode is still on"
        className="message-box window disconnect-guard"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !guard.busy) {
            event.preventDefault()
            playSound('cancel')
            cancelDisconnect()
          }
        }}
      >
        <header className="titlebar">
          <strong>{active ? 'Live Mode is still on' : 'MON left in Live Mode'}</strong>
          <span className="titlebar-spacer" />
          <button aria-label="Close" disabled={guard.busy} onClick={() => cancelDisconnect()}>
            ×
          </button>
        </header>
        <div className="message-box-content">
          <div className="message-body">
            <Icon name="warning" size={36} colour="#FEC343" />
            <div>
              <p>
                {active
                  ? `${amount} is in this browser's Live Mode wallet, and its session is still running. End the session now and the MON goes back to your wallet.`
                  : `This browser's Live Mode session is over, but ${amount} is still in its Live Mode wallet. Send it back to your wallet now?`}
              </p>
              <p className="muted">
                If you're switching to another browser or device, only this browser can send that MON back.
              </p>
              {guard.progress && <p>{guard.progress}</p>}
              {guard.error && <p className="disconnect-guard-error">{guard.error}</p>}
            </div>
          </div>
          <div className="dialog-actions">
            <Button autoFocus primary disabled={guard.busy} onClick={() => void endAndDisconnect()}>
              {guard.busy ? 'Working…' : active ? 'End session & disconnect' : 'Sweep & disconnect'}
            </Button>
            <Button disabled={guard.busy} onClick={() => disconnectAnyway()}>
              Disconnect anyway
            </Button>
            <Button disabled={guard.busy} onClick={() => cancelDisconnect()}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
