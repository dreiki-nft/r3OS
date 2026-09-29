import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { disconnectWallet, getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { openProgram, programById, programIsVisible, visiblePrograms } from './programs'
import { playSound } from './sound'
import { Icon } from './ui/Icon'
import { WalletChooser } from './WalletChooser'
import { getReleaseSnapshot, subscribeReleases } from './releases'

export function StartMenu({
  onClose,
  onShutdown,
  returnFocus,
}: {
  onClose: () => void
  onShutdown: () => void
  returnFocus: () => void
}) {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const releases = useSyncExternalStore(subscribeReleases, getReleaseSnapshot)
  const programs = visiblePrograms(releases)
  const visible = (id: string) => {
    const program = programById(id)
    return Boolean(program && programIsVisible(program, releases))
  }
  const [choosing, setChoosing] = useState(false)
  const [programsOpen, setProgramsOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const pointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        returnFocus()
        return
      }
      const items = [...(root.current?.querySelectorAll<HTMLElement>('[data-start-item]') ?? [])]
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
      const index = items.indexOf(active as HTMLElement)
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        items[(index + direction + items.length) % items.length]?.focus()
      }
      if (event.key === 'ArrowRight' && active?.dataset.programsRoot === '1') {
        event.preventDefault()
        setProgramsOpen(true)
      }
    }
    window.addEventListener('pointerdown', pointer)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', pointer)
      window.removeEventListener('keydown', key)
    }
  }, [onClose, returnFocus])

  const open = (id: string) => {
    openProgram(id)
    onClose()
    playSound('select')
  }

  return (
    <div ref={root} className="start-menu window">
      <div className="start-band">
        <b>r3tardOS</b>
        <span className="start-band-version"> 98</span>
      </div>
      <div className="start-items">
        <div
          className="programs-sub"
          onMouseEnter={() => setProgramsOpen(true)}
          onMouseLeave={() => setProgramsOpen(false)}
        >
          <button data-start-item data-programs-root="1" onClick={() => setProgramsOpen(!programsOpen)}>
            <Icon name="briefcase" size={24} />
            Programs ▸
          </button>
          {programsOpen && (
            <div className="submenu raised">
              {programs.map((program) => (
                <button data-start-item key={program.id} onClick={() => open(program.id)}>
                  <Icon name={program.icon} size={24} colour={program.colour} />
                  {program.title}
                </button>
              ))}
            </div>
          )}
        </div>
        {visible('pass') && (
          <button data-start-item onClick={() => open('pass')}>
            <Icon name="computer" size={24} />
            My Pass
          </button>
        )}
        {visible('frames') && (
          <button data-start-item onClick={() => open('frames')}>
            <Icon name="gallery" size={24} />
            My Frames
          </button>
        )}
        {visible('sounds') && (
          <button data-start-item onClick={() => open('sounds')}>
            <Icon name="music" size={24} />
            Sounds
          </button>
        )}
        {visible('help') && (
          <button data-start-item onClick={() => open('help')}>
            <Icon name="help" size={24} />
            Help
          </button>
        )}
        <hr />
        {wallet.account ? (
          <button
            data-start-item
            onClick={() => {
              disconnectWallet()
              playSound('system-shutdown')
              onClose()
            }}
          >
            <Icon name="key" size={24} />
            Disconnect
          </button>
        ) : (
          <>
            <button data-start-item onClick={() => setChoosing(!choosing)}>
              <Icon name="key" size={24} />
              Connect wallet…
            </button>
            {choosing && <WalletChooser onClose={onClose} />}
          </>
        )}
        <button data-start-item onClick={onShutdown}>
          <Icon name="flash" size={24} colour="#C52020" />
          Shut Down…
        </button>
      </div>
    </div>
  )
}
