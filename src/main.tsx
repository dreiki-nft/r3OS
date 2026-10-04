import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { R3OS } from './os/R3OS'
import { startBlockClock } from './chain/blocks'
import { initWalletDiscovery } from './chain/wallet'
import { startBootPrefetch } from './os/bootPrefetch'
import { startBrowserPerfObserver } from './chain/perf'
import './os/theme.css'

// Start launch-critical infrastructure before React renders the shell. The visible boot screen
// then spends its time on work that is already underway instead of waiting for an effect tick.
startBrowserPerfObserver()
initWalletDiscovery()
void startBlockClock()
void startBootPrefetch()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <R3OS />
  </StrictMode>,
)
