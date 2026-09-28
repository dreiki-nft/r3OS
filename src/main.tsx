import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { R3tardOS } from './os/R3tardOS'
import './os/theme.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <R3tardOS />
  </StrictMode>,
)
