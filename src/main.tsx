import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { R3tardOS } from './os/R3tardOS'
import { startBlockClock } from './chain/blocks'
import { initWalletDiscovery } from './chain/wallet'
import { startBootPrefetch } from './os/bootPrefetch'
import './os/theme.css'

// Start launch-critical infrastructure before React renders the shell. The visible boot screen
// then spends its time on work that is already underway instead of waiting for an effect tick.
initWalletDiscovery()
void startBlockClock()
void startBootPrefetch()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <R3tardOS />
  </StrictMode>,
)
