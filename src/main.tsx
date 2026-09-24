import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PaintApp } from './components/PaintApp'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PaintApp />
  </StrictMode>,
)
