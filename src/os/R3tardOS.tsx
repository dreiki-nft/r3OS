import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { FirstRun } from './FirstRun'
import { initLiveNudge } from '../live/liveNudge'
import { disconnectWallet } from '../chain/wallet'
import { Welcome } from './Welcome'
import { getBlockSnapshot, startBlockClock, subscribeBlocks } from '../chain/blocks'
import { startCanvasStore } from '../paint/canvasStore'
import { Assistant } from './Assistant'
import { setAssistantTip } from './assistantStore'
import { clearBalloons, pushBalloon } from './balloons'
import { Desktop } from './Desktop'
import { openProgram, programById, programIsVisible } from './programs'
import { playSound } from './sound'
import { StormScreen } from './StormScreen'
import { Taskbar } from './Taskbar'
import { BalloonStack } from './ui/BalloonStack'
import { ConfirmHost } from './ui/ConfirmHost'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { MessageBox } from './ui/MessageBox'
import { Window } from './Window'
import { clampAllWindows, getWindows, resetWindows, sortWindowsForDisplay, subscribeWindows } from './windows'
import { initSound } from './sound'
import { initWalletDiscovery } from '../chain/wallet'
import {
  availableScheduledPrograms,
  consumeInstallAnnouncement,
  getReleaseSnapshot,
  initReleases,
  subscribeReleases,
} from './releases'

function ProgramLoading() {
  return <div className="program-loading">⌛ loading program…</div>
}

export function R3tardOS() {
  const windows = useSyncExternalStore(subscribeWindows, getWindows)
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const releases = useSyncExternalStore(subscribeReleases, getReleaseSnapshot)
  const [stormId, setStormId] = useState<bigint>()
  const [notInstalled, setNotInstalled] = useState<string>()
  const [shutdown, setShutdown] = useState(false)
  const currentStorm = block.stormId

  useEffect(() => {
    initSound()
    initWalletDiscovery()
    initLiveNudge()
    void initReleases()
    void startBlockClock()
    void startCanvasStore()
    window.addEventListener('resize', clampAllWindows)
    return () => window.removeEventListener('resize', clampAllWindows)
  }, [])

  useEffect(() => {
    const locked = (event: Event) => {
      const detail = (event as CustomEvent<{ title?: string }>).detail
      setNotInstalled(detail?.title ?? 'this program')
    }
    window.addEventListener('r3os:not-installed', locked)
    return () => window.removeEventListener('r3os:not-installed', locked)
  }, [])

  // The hash opens a program once: on first load (after releases load) and on a real hashchange.
  // Release-store refreshes (every minute) must not reopen a window the user already closed.
  const routedHash = useRef<string | undefined>(undefined)
  useEffect(() => {
    const route = (force: boolean) => {
      const hash = location.hash
      if (!force && hash === routedHash.current) return
      const id = hash.split('/')[1]?.split('?')[0]
      if (!id || !programById(id) || releases.status === 'loading') return
      routedHash.current = hash
      if (openProgram(id, false)) setNotInstalled(undefined)
    }
    route(false)
    const onHashChange = () => route(true)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [releases.version])

  useEffect(() => {
    if (releases.revealAll) return
    for (const id of availableScheduledPrograms(releases)) {
      const program = programById(id)
      if (!program || !consumeInstallAnnouncement(id)) continue
      pushBalloon({
        id: `installed:${id}`,
        title: `New program installed: ${program.title}`,
        body: 'ready to use.',
        icon: program.icon,
        href: program.hash,
        hrefLabel: 'Open',
        sound: 'success-heavy',
      })
    }
  }, [releases])

  useEffect(() => {
    if (currentStorm == null) return
    let seen = false
    try {
      seen = sessionStorage.getItem(`r3os.storm.${currentStorm}`) === '1'
    } catch {
      // Session storage can be blocked.
    }
    if (!seen) {
      setStormId(currentStorm)
      setAssistantTip("storm's here. fresh pixels glitch at 200% for 600 blocks")
    }
  }, [currentStorm])

  const dismissStorm = () => {
    if (stormId != null) {
      try {
        sessionStorage.setItem(`r3os.storm.${stormId}`, '1')
      } catch {
        // Session storage can be blocked.
      }
    }
    setStormId(undefined)
  }

  return (
    <main className={`r3os ${block.storm ? 'storm-active' : ''}`}>
      <div className="wallpaper" />
      <div className="vignette" />
      <div className="noise" />
      <div className="grain" />
      <div className="scratch s1" />
      <div className="scratch s2" />
      <span className="tag t1">NO SIGNAL</span>
      <span className="tag t2">DF1 200%</span>
      <span className="heart">♡</span>
      <Desktop />
      <Welcome />
      <FirstRun />
      {windows.windows.some((win) => programById(win.id)?.modal && !win.minimized) && (
        <div className="modal-program-shade" />
      )}
      {sortWindowsForDisplay(windows.windows).map((win) => {
        const program = programById(win.id)
        if (!program || (!program.hidden && !programIsVisible(program, releases))) return null
        const Component = program.component
        const rawToken = new URLSearchParams(location.hash.split('?')[1] ?? '').get('token') ?? ''
        // Only digits reach the title bar: a shared link can't write its own words into the OS chrome.
        const frameToken = /^\d{1,78}$/.test(rawToken) ? rawToken : '?'
        return (
          <Window
            key={win.id}
            win={win}
            active={windows.active === win.id}
            title={
              win.id === 'paint'
                ? 'canvas.bmp - Paint'
                : win.id === 'frame-props'
                  ? `frame #${frameToken} Properties`
                  : win.id === 'validators'
                    ? 'Network Neighborhood'
                    : program.title
            }
            icon={program.icon}
            controls={program.controls}
            pinToggle={program.pinToggle}
            onHelp={() => openProgram('help')}
          >
            <Suspense fallback={<ProgramLoading />}>
              <Component />
            </Suspense>
          </Window>
        )
      })}
      <Assistant />
      <BalloonStack />
      <ConfirmHost />
      <ErrorBoundary mode="taskbar">
        <Taskbar
          onShutdown={() => {
            disconnectWallet()
            resetWindows()
            clearBalloons()
            playSound('system-shutdown')
            setShutdown(true)
          }}
        />
      </ErrorBoundary>
      {stormId != null && <StormScreen start={block.stormStart ?? 0n} onDismiss={dismissStorm} />}
      {notInstalled && (
        <MessageBox
          title={notInstalled}
          message="this program isn't installed yet."
          onClose={() => setNotInstalled(undefined)}
        />
      )}
      {shutdown && (
        <MessageBox
          title="Shut Down"
          message="it is now safe to close your wallet."
          onClose={() => setShutdown(false)}
        />
      )}
    </main>
  )
}
