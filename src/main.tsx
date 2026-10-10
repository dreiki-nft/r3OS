import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { R3OS } from './os/R3OS'
import { startBlockClock } from './chain/blocks'
import { initWalletDiscovery } from './chain/wallet'
import { startBootPrefetch } from './os/bootPrefetch'
import { startBrowserPerfObserver } from './chain/perf'
import './os/theme.css'
import './os/phone.css'

// Start launch-critical infrastructure before React renders the shell. The visible boot screen
// then spends its time on work that is already underway instead of waiting for an effect tick.
// After a deploy, a tab that was already open asks for program chunks that no longer exist (their file names
// changed with the build). Reload once to pick up the new build instead of showing a broken window. The
// timestamp stops a loop if the chunk is missing for some other reason.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'r3os.chunkReloadAt'
  let last = 0
  try {
    last = Number(sessionStorage.getItem(KEY)) || 0
    if (Date.now() - last < 60_000) return
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    return
  }
  event.preventDefault()
  location.reload()
})

startBrowserPerfObserver()
initWalletDiscovery()
void startBlockClock()
void startBootPrefetch()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <R3OS />
  </StrictMode>,
)
