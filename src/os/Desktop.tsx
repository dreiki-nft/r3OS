import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { requestRecycle } from './programs/recycleIntent'
import { openProgram, preloadProgram, programById, programIsVisible, type ProgramDef } from './programs'
import { desktopProgramIds } from './layout'
import { useAuctionLive } from '../labs/auctionLive'
import { playSound } from './sound'
import { Icon } from './ui/Icon'
import { publicClient, wsClient } from '../chain/clients'
import { discoverContracts } from '../chain/contracts'
import { R3OS_RECYCLE_BIN_ABI } from '../lib/generated/abi'
import { getReleaseSnapshot, programNeedsSparkle, subscribeReleases } from './releases'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { currentDisc, getCdromVersion, subscribeCdrom, volumeLabel } from '../cdrom/cdromStore'
import { CLOSE_MENUS_EVENT, ContextMenu, closeShellMenus } from './ContextMenu'
import {
  LONG_PRESS_MS,
  classifyDesktopTarget,
  desktopMenuItems,
  iconMenuItems,
  movedBeyondThreshold,
  type DesktopTarget,
  type ShellAction,
} from './shellMenus'
import { refreshReleaseClock } from './releases'
import { isPhoneScreen } from './phone'
import { resilientWatch } from '../chain/resilientWatch'

/** Decorative layers of the desktop surface: a right-click / long-press here belongs to the desktop. */
const SURFACE_CLASSES = [
  'r3os',
  'wallpaper',
  'vignette',
  'noise',
  'grain',
  'desktop-icons',
]

/** DOM → classification input. Only the bare surface and desktop icons are claimed. */
function desktopTargetOf(target: EventTarget | null): DesktopTarget {
  const element = target instanceof Element ? target : null
  if (!element) return { kind: 'ignore' }
  const editable = Boolean(
    element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'),
  )
  const icon = element.closest<HTMLElement>('.desktop-icon[data-index]')
  const onSurface = SURFACE_CLASSES.some((name) => element.classList.contains(name))
  return classifyDesktopTarget({
    editable,
    insideOwnedUi: !icon && !onSurface,
    iconIndex: icon ? Number(icon.dataset.index) : undefined,
    onSurface,
  })
}

type MenuState = { x: number; y: number; target: DesktopTarget }

export function desktopRows(height = typeof innerHeight === 'number' ? innerHeight : 900) {
  return Math.max(1, Math.floor((height - 48 - 16) / 88))
}

export function Desktop() {
  const releases = useSyncExternalStore(subscribeReleases, getReleaseSnapshot)
  const auctionLive = useAuctionLive()
  // Only the programs that define r3OS sit on the desktop; the rest live in Start (src/os/layout.ts).
  const programs = useMemo(
    () =>
      desktopProgramIds((id) => {
        const program = programById(id)
        return Boolean(program && programIsVisible(program, releases))
      }, auctionLive)
        .map((id) => programById(id))
        .filter((program): program is ProgramDef => Boolean(program)),
    [releases, auctionLive],
  )
  const [selected, setSelected] = useState(0)
  const rows = useMemo(() => desktopRows(), [])
  const [binFull, setBinFull] = useState(false)
  const [binVersion, setBinVersion] = useState(0)
  const [menu, setMenu] = useState<MenuState>()
  const grid = useRef<HTMLDivElement>(null)
  const suppressClickUntil = useRef(0)
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  useSyncExternalStore(subscribeCdrom, getCdromVersion)
  const disc = currentDisc(wallet.account)

  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false
    const client = publicClient
    void (async () => {
      if (!client) return
      const bin = (await discoverContracts()).labs['recycle-bin']
      if (!bin) return
      const read = async () => {
        const total = BigInt(
          await client.readContract({
            address: bin,
            abi: R3OS_RECYCLE_BIN_ABI,
            functionName: 'totalBurned',
          }),
        )
        if (!cancelled) setBinFull(total > 0n)
      }
      await read()
      if (wsClient) {
        const client = wsClient
        stop = resilientWatch(
          (onError) =>
            client.watchContractEvent({
              address: bin,
              abi: R3OS_RECYCLE_BIN_ABI,
              eventName: 'Recycled',
              onLogs: () => void read(),
              onError,
            }),
          () => void read().catch(() => undefined),
        )
      }
    })().catch(() => undefined)
    return () => {
      cancelled = true
      stop?.()
    }
  }, [binVersion])

  const open = (index: number) => programs[index] && openProgram(programs[index].id)
  const closeMenu = useCallback(() => setMenu(undefined), [])

  const showMenu = useCallback((x: number, y: number, target: DesktopTarget) => {
    if (target.kind === 'ignore') return
    closeShellMenus() // a new context menu replaces any other open shell menu
    if (target.kind === 'icon') setSelected(target.index)
    else setSelected(-1)
    setMenu({ x, y, target })
  }, [])

  // The desktop surface (main.r3os and its decorative layers) and the icons own contextmenu and touch
  // long-press. Everything else (windows, inputs, the taskbar, other menus) keeps its own behaviour.
  useEffect(() => {
    const surface = grid.current?.parentElement
    if (!surface) return
    let press: { id: number; x: number; y: number; timer: number; target: DesktopTarget } | undefined
    const cancel = () => {
      if (press) window.clearTimeout(press.timer)
      press = undefined
    }
    const onContextMenu = (event: MouseEvent) => {
      const target = desktopTargetOf(event.target)
      if (target.kind === 'ignore') return
      event.preventDefault()
      // Android fires contextmenu after its own long-press; the long-press timer already opened the menu.
      if (Date.now() < suppressClickUntil.current) return
      // A touch long-press may reach contextmenu before our own timer: take it over, and still swallow
      // the tap that ends the press.
      if (press) suppressClickUntil.current = Date.now() + 700
      cancel()
      showMenu(event.clientX, event.clientY, target)
    }
    const onPointerDown = (event: PointerEvent) => {
      cancel()
      if (event.pointerType === 'mouse' || !event.isPrimary) return
      const target = desktopTargetOf(event.target)
      if (target.kind === 'ignore') return
      const { clientX: x, clientY: y } = event
      press = {
        id: event.pointerId,
        x,
        y,
        target,
        timer: window.setTimeout(() => {
          press = undefined
          // The touch that opened the menu must not also tap-open the icon underneath.
          suppressClickUntil.current = Date.now() + 700
          showMenu(x, y, target)
        }, LONG_PRESS_MS),
      }
    }
    const onPointerMove = (event: PointerEvent) => {
      if (
        press &&
        event.pointerId === press.id &&
        movedBeyondThreshold(press, { x: event.clientX, y: event.clientY })
      )
        cancel()
    }
    const onPointerEnd = (event: PointerEvent) => {
      if (press && event.pointerId === press.id) cancel()
    }
    surface.addEventListener('contextmenu', onContextMenu)
    surface.addEventListener('pointerdown', onPointerDown)
    surface.addEventListener('pointermove', onPointerMove)
    surface.addEventListener('pointerup', onPointerEnd)
    surface.addEventListener('pointercancel', onPointerEnd)
    return () => {
      cancel()
      surface.removeEventListener('contextmenu', onContextMenu)
      surface.removeEventListener('pointerdown', onPointerDown)
      surface.removeEventListener('pointermove', onPointerMove)
      surface.removeEventListener('pointerup', onPointerEnd)
      surface.removeEventListener('pointercancel', onPointerEnd)
    }
  }, [showMenu])

  // Opening the Start menu (or another shell menu) closes the desktop menu.
  useEffect(() => {
    window.addEventListener(CLOSE_MENUS_EVENT, closeMenu)
    return () => window.removeEventListener(CLOSE_MENUS_EVENT, closeMenu)
  }, [closeMenu])

  const runAction = (action: ShellAction) => {
    if (action.type === 'refresh') {
      // Re-evaluate what the desktop shows: release visibility at the current time and the Recycle Bin
      // state (one read). No page reload, no fake work.
      setSelected(-1)
      refreshReleaseClock()
      setBinVersion((value) => value + 1)
      return
    }
    openProgram(action.program, true, action.hash)
  }
  const choose = (index: number) => {
    setSelected(index)
    if (programs[index]) void preloadProgram(programs[index].id)
    playSound('select')
  }

  return (
    <>
      <div
        ref={grid}
        className="desktop-icons"
        role="grid"
        tabIndex={0}
        style={{ gridTemplateRows: `repeat(${rows}, 88px)` }}
        onKeyDown={(event) => {
          let next = selected
          if (event.key === 'ArrowDown') next = Math.min(programs.length - 1, Math.max(-1, selected) + 1)
          if (event.key === 'ArrowUp') next = Math.max(0, selected - 1)
          if (event.key === 'ArrowRight') next = Math.min(programs.length - 1, selected + rows)
          if (event.key === 'ArrowLeft') next = Math.max(0, selected - rows)
          if (event.key === 'Enter') open(selected)
          // Shift+F10 / ContextMenu key: the selected icon's menu, at the icon.
          if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
            event.preventDefault()
            const icon = grid.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
            const rect = icon?.getBoundingClientRect()
            if (rect && selected >= 0)
              showMenu(rect.left + rect.width / 2, rect.top + rect.height / 2, {
                kind: 'icon',
                index: selected,
              })
            return
          }
          if (next !== selected) choose(next)
        }}
      >
        {programs.map((program, index) => (
          <button
            role="gridcell"
            key={program.id}
            data-index={index}
            className={`desktop-icon ${selected === index ? 'selected' : ''} ${program.id === 'bin' && binFull ? 'desktop-bin-full' : ''} ${programNeedsSparkle(program.id, releases) ? 'desktop-icon-new' : ''}`}
            onMouseEnter={() => void preloadProgram(program.id)}
            onFocus={() => void preloadProgram(program.id)}
            onDragOver={(event) => {
              if (program.id === 'bin' && event.dataTransfer.types.includes('application/x-r3-frame'))
                event.preventDefault()
            }}
            onDrop={(event) => {
              if (program.id !== 'bin') return
              const id = Number(event.dataTransfer.getData('application/x-r3-frame'))
              if (id > 0) {
                event.preventDefault()
                recycleFrame(Number(id))
              }
            }}
            onClick={() => {
              if (Date.now() < suppressClickUntil.current) return
              choose(index)
              if (isPhoneScreen()) open(index)
            }}
            onDoubleClick={() => open(index)}
          >
            <span className="desktop-icon-art">
              <Icon
                name={program.id === 'cdrom' && disc ? 'disc' : program.icon}
                size={36}
                colour={program.colour}
              />
              {program.id === 'bin' && binFull && <i className="desktop-bin-paper" aria-label="full" />}
            </span>
            <span className="desktop-icon-label">
              {program.id === 'cdrom' && disc ? `${volumeLabel(disc.label)} (D:)` : program.title}
            </span>
          </button>
        ))}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={
            menu.target.kind === 'icon'
              ? `${programs[menu.target.index]?.title ?? 'icon'} menu`
              : 'Desktop menu'
          }
          items={
            menu.target.kind === 'icon' && programs[menu.target.index]
              ? iconMenuItems(programs[menu.target.index].id)
              : desktopMenuItems()
          }
          onAction={runAction}
          onClose={closeMenu}
        />
      )}
    </>
  )
}

/** Open the Recycle Bin with this frame ready to confirm (in-memory request; see recycleIntent.ts). */
function recycleFrame(id: number) {
  requestRecycle(id)
  openProgram('bin')
}
