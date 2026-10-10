import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type LazyExoticComponent,
} from 'react'
import { BootScreen } from './BootScreen'
import { isBooting, subscribeBooting } from './bootState'
import { WallpaperLayer } from './WallpaperLayer'
import { FloppyDialog } from './FloppyDialog'
import { ActivityHost } from './ActivityHost'
import { ScreensaverOverlay } from './ScreensaverOverlay'
import { FirstRun } from './FirstRun'
import { isFirstRunOpen, subscribeFirstRun } from './firstRunState'
import { initLiveNudge } from '../live/liveNudge'
import { disconnectWallet, takeGuestNotice } from '../chain/wallet'
import { Welcome } from './Welcome'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { startPresence } from '../paint/presence'
import { initActivity } from './activity'
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
import { markProgramMounted } from '../chain/perf'
import { isTvRoute } from '../tv/tvModel'
import {
  availableScheduledPrograms,
  consumeInstallAnnouncement,
  getReleaseSnapshot,
  initReleases,
  subscribeReleases,
} from './releases'
import { isPhoneScreen } from './phone'
import { watchGuestLinks } from '../chain/guestWallet'

const TvView = lazy(() => import('../tv/TvView').then((module) => ({ default: module.TvView })))

function ProgramLoading() {
  return <div className="program-loading">⌛ loading program…</div>
}

function MeasuredProgram({
  id,
  Component,
}: {
  id: string
  Component: ComponentType | LazyExoticComponent<ComponentType>
}) {
  useEffect(() => markProgramMounted(id), [id])
  return <Component />
}

const stormActiveSnapshot = () => getBlockSnapshot().storm
const stormIdSnapshot = () => getBlockSnapshot().stormId
const stormStartSnapshot = () => getBlockSnapshot().stormStart

export function R3OS() {
  const windows = useSyncExternalStore(subscribeWindows, getWindows)
  // The shell only cares when storm state changes. Subscribing to the whole block snapshot
  // made the entire desktop/window tree reconcile ~3x per second for no visual benefit.
  const stormActive = useSyncExternalStore(subscribeBlocks, stormActiveSnapshot)
  const currentStorm = useSyncExternalStore(subscribeBlocks, stormIdSnapshot)
  const stormStart = useSyncExternalStore(subscribeBlocks, stormStartSnapshot)
  const releases = useSyncExternalStore(subscribeReleases, getReleaseSnapshot)
  const booting = useSyncExternalStore(subscribeBooting, isBooting)
  const firstRunOpen = useSyncExternalStore(subscribeFirstRun, isFirstRunOpen)
  const [startupQuiet, setStartupQuiet] = useState(true)
  const [stormId, setStormId] = useState<bigint>()
  const [notInstalled, setNotInstalled] = useState<string>()
  const [shutdown, setShutdown] = useState(false)
  const [tvOpen, setTvOpen] = useState(() => isTvRoute(location.hash))

  useEffect(() => {
    const onHashChange = () => setTvOpen(isTvRoute(location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    initSound()
    initLiveNudge()
    void initReleases()
    startPresence()
    initActivity()
    window.addEventListener('resize', clampAllWindows)
    return () => window.removeEventListener('resize', clampAllWindows)
  }, [])

  useEffect(() => {
    // A judge opened a private guest link: say what this wallet is, once.
    const show = () => {
      const address = takeGuestNotice()
      if (!address) return
      pushBalloon({
        id: 'guest-wallet',
        icon: 'key',
        title: 'Guest wallet connected',
        body: `${address.slice(0, 6)}…${address.slice(-4)} holds a little demo MON so you can paint right away. it's a throwaway wallet for judges: anything it paints counts under this guest address, not as a community painter.`,
        // On a phone it would sit over Paint's tools, so there it fades like any other balloon.
        sticky: !isPhoneScreen(),
        actions: [{ label: 'Open Paint', run: () => void openProgram('paint') }],
      })
    }
    show()
    window.addEventListener('r3os:guest-wallet', show)
    const stopWatching = watchGuestLinks()
    return () => {
      window.removeEventListener('r3os:guest-wallet', show)
      stopWatching()
    }
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
    if (booting || firstRunOpen) {
      setStartupQuiet(true)
      return
    }
    const timer = window.setTimeout(() => setStartupQuiet(false), 30_000)
    return () => window.clearTimeout(timer)
  }, [booting, firstRunOpen])

  useEffect(() => {
    if (startupQuiet || releases.revealAll) return
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
  }, [releases, startupQuiet])

  useEffect(() => {
    if (startupQuiet || currentStorm == null) return
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
  }, [currentStorm, startupQuiet])

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
    <main className={`r3os ${stormActive ? 'storm-active' : ''}`}>
      <WallpaperLayer />
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
      <ActivityHost />
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
              <MeasuredProgram id={win.id} Component={Component} />
            </Suspense>
          </Window>
        )
      })}
      <FloppyDialog />
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
      {stormId != null && <StormScreen start={stormStart ?? 0n} onDismiss={dismissStorm} />}
      {notInstalled && (
        <MessageBox
          title={notInstalled}
          message="this program isn't installed yet."
          onClose={() => setNotInstalled(undefined)}
        />
      )}
      {!tvOpen && <ScreensaverOverlay />}
      <BootScreen />
      {tvOpen && (
        <ErrorBoundary>
          <Suspense fallback={null}>
            <TvView />
          </Suspense>
        </ErrorBoundary>
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
