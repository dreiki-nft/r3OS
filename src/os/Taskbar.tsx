import { useRef, useState, useSyncExternalStore } from 'react'
import { focusWindow, getWindows, minimizeWindow, subscribeWindows } from './windows'
import { programById, programIsVisible } from './programs'
import { StartMenu } from './StartMenu'
import { closeShellMenus } from './ContextMenu'
import { Tray } from './Tray'
import { Icon } from './ui/Icon'
import { SafeImage } from './ui/SafeImage'
import { getReleaseSnapshot, subscribeReleases } from './releases'

export function Taskbar({ onShutdown }: { onShutdown: () => void }) {
  const state = useSyncExternalStore(subscribeWindows, getWindows)
  const releases = useSyncExternalStore(subscribeReleases, getReleaseSnapshot)
  const [open, setOpen] = useState(false)
  const startButton = useRef<HTMLButtonElement>(null)

  return (
    <>
      <footer className="taskbar">
        <button
          ref={startButton}
          className={`start-button raised ${open ? 'pressed' : ''}`}
          onClick={() => {
            if (!open) closeShellMenus()
            setOpen(!open)
          }}
        >
          <SafeImage src="/os/brand/logo.png" alt="r3tards" width={28} height={28} />
          r3tards
        </button>
        <div className="task-buttons">
          {state.windows.map((win) => {
            const program = programById(win.id)
            if (!program || (!program.hidden && !programIsVisible(program, releases))) return null
            return (
              <button
                key={win.id}
                className={`task-button raised ${state.active === win.id && !win.minimized ? 'active' : ''}`}
                onClick={() =>
                  state.active === win.id && !win.minimized ? minimizeWindow(win.id) : focusWindow(win.id)
                }
              >
                <Icon name={program.icon} size={20} colour={program.colour} />
                {program.title}
              </button>
            )
          })}
        </div>
        <Tray />
      </footer>
      {open && (
        <StartMenu
          onClose={() => setOpen(false)}
          returnFocus={() => startButton.current?.focus()}
          onShutdown={() => {
            setOpen(false)
            onShutdown()
          }}
        />
      )}
    </>
  )
}
