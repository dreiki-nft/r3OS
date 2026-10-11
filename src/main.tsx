import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { R3OS } from './os/R3OS'
import { startBlockClock } from './chain/blocks'
import { initWalletDiscovery } from './chain/wallet'
import { startBootPrefetch } from './os/bootPrefetch'
import { startBrowserPerfObserver } from './chain/perf'
import { installDomGuard } from './os/domGuard'
import './os/theme.css'
import './os/phone.css'

// Start launch-critical infrastructure before React renders the shell. The visible boot screen
// then spends its time on work that is already underway instead of waiting for an effect tick.
// After a deploy, a tab that was already open asks for program chunks that no longer exist (their file names
// changed with the build). Reload once to pick up the new build instead of showing a broken window. The
// timestamp stops a loop if the chunk is missing for some other reason.
// A plain reload can be served the same stale cached page (MetaMask's Android browser does), so public/stale-guard.js
// loads a fresh copy under a new query instead; it also allows only one try a minute.
type FreshReload = () => boolean
window.addEventListener('vite:preloadError', (event) => {
  const fresh = (window as unknown as { __r3osFreshReload?: FreshReload }).__r3osFreshReload
  if (fresh) {
    if (fresh()) event.preventDefault()
    return
  }
  // The guard script didn't load: fall back to one plain reload a minute.
  try {
    const KEY = 'r3os.freshReloadAt'
    if (Date.now() - (Number(sessionStorage.getItem(KEY)) || 0) < 60_000) return
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    return
  }
  event.preventDefault()
  location.reload()
})
// Tidy the address bar after a fresh reload; every other query parameter stays.
{
  const url = new URL(location.href)
  if (url.searchParams.has('fresh')) {
    url.searchParams.delete('fresh')
    history.replaceState(history.state, '', url)
  }
}

// Before React renders: page translators must not be able to crash a window.
installDomGuard()
startBrowserPerfObserver()
initWalletDiscovery()
void startBlockClock()
void startBootPrefetch()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <R3OS />
  </StrictMode>,
)
