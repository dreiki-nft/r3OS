import { Suspense, useEffect, useState, useSyncExternalStore } from 'react'
import { disconnectWallet } from '../chain/wallet'
import { getBlockSnapshot, startBlockClock, subscribeBlocks } from '../chain/blocks'
import { startCanvasStore } from '../paint/canvasStore'
import { Assistant } from './Assistant'
import { setAssistantTip } from './assistantStore'
import { clearBalloons } from './balloons'
import { Desktop } from './Desktop'
import { openProgram, programById } from './programs'
import { playSound } from './sound'
import { StormScreen } from './StormScreen'
import { Taskbar } from './Taskbar'
import { BalloonStack } from './ui/BalloonStack'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { MessageBox } from './ui/MessageBox'
import { Window } from './Window'
import { clampAllWindows, getWindows, resetWindows, sortWindowsForDisplay, subscribeWindows } from './windows'
import { initSound } from './sound'
import { initWalletDiscovery } from '../chain/wallet'

function ProgramLoading() {
  return <div className="program-loading">⌛ loading program…</div>
}

export function R3tardOS() {
  const windows = useSyncExternalStore(subscribeWindows, getWindows)
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const [stormId, setStormId] = useState<bigint>()
  const [shutdown, setShutdown] = useState(false)
  const currentStorm = block.stormId

  useEffect(() => {
    initSound()
    initWalletDiscovery()
    void startBlockClock()
    void startCanvasStore()
    window.addEventListener('resize', clampAllWindows)
    return () => window.removeEventListener('resize', clampAllWindows)
  }, [])

  useEffect(() => {
    const route = () => {
      const id = location.hash.split('/')[1]?.split('?')[0]
      if (id && programById(id)) openProgram(id, false)
    }
    route()
    window.addEventListener('hashchange', route)
    return () => window.removeEventListener('hashchange', route)
  }, [])

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
      {windows.windows.some((win) => programById(win.id)?.modal && !win.minimized) && (
        <div className="modal-program-shade" />
      )}
      {sortWindowsForDisplay(windows.windows).map((win) => {
        const program = programById(win.id)
        if (!program) return null
        const Component = program.component
        const frameToken = new URLSearchParams(location.hash.split('?')[1] ?? '').get('token') ?? '?'
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
