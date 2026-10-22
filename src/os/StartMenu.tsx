import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { disconnectWallet, getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { requestDisconnect } from '../live/disconnectGuardStore'
import { startMenuGroups } from './layout'
import { openProgram, preloadProgram, programById, programIsVisible, type ProgramDef } from './programs'
import { placeSubmenu, startMenuKeyAction, toggleSubmenu, type StartSubmenu } from './shellMenus'
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
  const visible = (id: string) => {
    const program = programById(id)
    return Boolean(program && programIsVisible(program, releases))
  }
  // Programs ▸ · Explore Monad · System Tools ▸ · Help · Run… (src/os/layout.ts).
  const groups = startMenuGroups(visible)
  const toDefs = (ids: string[]) =>
    ids.map((id) => programById(id)).filter((program): program is ProgramDef => Boolean(program))
  const regularPrograms = toDefs(groups.programs)
  const toolPrograms = toDefs(groups.tools)
  const explore = groups.explore ? programById(groups.explore) : undefined
  const [choosing, setChoosing] = useState(false)
  const [submenu, setSubmenu] = useState<StartSubmenu | null>(null)
  const [focusFirst, setFocusFirst] = useState(false)
  const [placement, setPlacement] = useState<{ left: number; top: number; maxHeight: number }>()
  const root = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)
  const parents = useRef<Partial<Record<StartSubmenu, HTMLButtonElement | null>>>({})
  const hoverTimer = useRef<number | undefined>(undefined)
  const submenuState = useRef<StartSubmenu | null>(null)
  submenuState.current = submenu

  const schedule = (fn: () => void, ms: number) => {
    window.clearTimeout(hoverTimer.current)
    hoverTimer.current = window.setTimeout(fn, ms)
  }
  useEffect(() => () => window.clearTimeout(hoverTimer.current), [])

  // Place the open submenu beside its parent row, inside the viewport (right, else left, else overlay).
  useLayoutEffect(() => {
    if (!submenu) return setPlacement(undefined)
    const parent = parents.current[submenu]
    const node = submenuRef.current
    if (!parent || !node) return
    const rect = parent.getBoundingClientRect()
    const placed = placeSubmenu(
      rect,
      { width: node.offsetWidth, height: node.scrollHeight },
      { width: window.innerWidth, height: window.innerHeight },
    )
    setPlacement({ left: placed.left, top: placed.top, maxHeight: placed.maxHeight })
  }, [submenu, regularPrograms.length, toolPrograms.length])

  useEffect(() => {
    if (!focusFirst || !placement) return
    submenuRef.current?.querySelector<HTMLElement>('[data-sub-item]')?.focus()
    setFocusFirst(false)
  }, [focusFirst, placement])

  useEffect(() => {
    const pointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose()
    }
    const key = (event: KeyboardEvent) => {
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
      const inSubmenu = Boolean(active?.closest('.submenu'))
      const parentOf = active?.dataset.submenuParent as StartSubmenu | undefined
      const action = startMenuKeyAction({
        key: event.key,
        inSubmenu,
        onSubmenuParent: Boolean(parentOf),
        submenuOpen: submenuState.current != null,
      })
      if (!action) return
      event.preventDefault()
      if (action === 'close-start') {
        onClose()
        returnFocus()
        return
      }
      if (action === 'open-submenu' && parentOf) {
        setSubmenu(parentOf)
        setFocusFirst(true)
        return
      }
      if (action === 'close-submenu') {
        const open = submenuState.current
        setSubmenu(null)
        if (open) parents.current[open]?.focus()
        return
      }
      // next / prev move within one level: the submenu, or the top-level items (never flattened together).
      const scope = inSubmenu ? submenuRef.current : root.current
      const items = [
        ...(scope?.querySelectorAll<HTMLElement>(inSubmenu ? '[data-sub-item]' : '[data-start-item]') ?? []),
      ]
      const index = items.indexOf(active as HTMLElement)
      const step = action === 'next' ? 1 : -1
      items[(index + step + items.length) % items.length]?.focus()
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

  const cascade = (which: StartSubmenu, label: string, icon: ReactNode, items: ProgramDef[]) => (
    <div
      className="programs-sub"
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse') return
        // Hover opens after a short delay; moving into the submenu cancels any pending close.
        schedule(() => setSubmenu(which), submenuState.current === which ? 0 : 90)
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'mouse') return
        schedule(() => setSubmenu((current) => (current === which ? null : current)), 350)
      }}
    >
      <button
        ref={(node) => {
          parents.current[which] = node
        }}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={submenu === which}
        data-start-item
        data-submenu-parent={which}
        data-programs-root={which === 'programs' ? '1' : undefined}
        data-tools-root={which === 'tools' ? '1' : undefined}
        className={submenu === which ? 'expanded' : undefined}
        onClick={() => {
          window.clearTimeout(hoverTimer.current)
          setSubmenu((current) => toggleSubmenu(current, which))
        }}
      >
        {icon}
        <span className="start-item-label">{label}</span>
        <span className="start-item-arrow" aria-hidden="true">
          ▸
        </span>
      </button>
      {submenu === which && (
        <div
          ref={submenuRef}
          role="menu"
          aria-label={label}
          className="submenu raised"
          style={
            placement
              ? { left: placement.left, top: placement.top, maxHeight: placement.maxHeight }
              : { visibility: 'hidden' }
          }
        >
          {items.map((program) => (
            <button
              role="menuitem"
              data-sub-item
              key={program.id}
              onMouseEnter={() => void preloadProgram(program.id)}
              onFocus={() => void preloadProgram(program.id)}
              onClick={() => open(program.id)}
            >
              <Icon name={program.icon} size={24} colour={program.colour} />
              <span className="start-item-label">{program.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div ref={root} className="start-menu window">
      <div className="start-band">
        <b>r3OS</b>
        <span className="start-band-version"> 98</span>
      </div>
      <div className="start-items" role="menu" aria-label="Start">
        {cascade('programs', 'Programs', <Icon name="briefcase" size={24} />, regularPrograms)}
        {explore && (
          <button
            role="menuitem"
            data-start-item
            onMouseEnter={() => void preloadProgram(explore.id)}
            onFocus={() => void preloadProgram(explore.id)}
            onClick={() => open(explore.id)}
          >
            <Icon name={explore.icon} size={24} colour={explore.colour} />
            {explore.title}
          </button>
        )}
        {toolPrograms.length > 0 &&
          cascade('tools', 'System Tools', <Icon name="chip" size={24} />, toolPrograms)}
        {groups.help && (
          <button
            role="menuitem"
            data-start-item
            onMouseEnter={() => void preloadProgram('help')}
            onFocus={() => void preloadProgram('help')}
            onClick={() => open('help')}
          >
            <Icon name="help" size={24} />
            Help
          </button>
        )}
        <button role="menuitem" data-start-item onClick={() => open('run')}>
          <Icon name="rocket" size={24} colour="#FEC343" />
          Run…
        </button>
        <hr role="separator" />
        {wallet.account ? (
          <button
            role="menuitem"
            data-start-item
            onClick={() => {
              onClose()
              // Asks first if this browser still holds a running Live Mode session or leftover MON.
              requestDisconnect(() => {
                disconnectWallet()
                playSound('system-shutdown')
              })
            }}
          >
            <Icon name="key" size={24} />
            Disconnect
          </button>
        ) : (
          <>
            <button role="menuitem" data-start-item onClick={() => setChoosing(!choosing)}>
              <Icon name="key" size={24} />
              Connect wallet…
            </button>
            {choosing && <WalletChooser onClose={onClose} />}
          </>
        )}
        <button role="menuitem" data-start-item onClick={onShutdown}>
          <Icon name="flash" size={24} colour="#C52020" />
          Shut Down…
        </button>
      </div>
    </div>
  )
}
