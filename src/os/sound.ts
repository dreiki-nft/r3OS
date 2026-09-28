export type SoundName =
  | 'system-initiate'
  | 'system-shutdown'
  | 'select'
  | 'confirm'
  | 'cancel'
  | 'success-light'
  | 'success-heavy'
  | 'error'
  | 'storm'
  | 'df1'
  | 'cute-bubble'
  | 'text'
const names: SoundName[] = [
  'system-initiate',
  'system-shutdown',
  'select',
  'confirm',
  'cancel',
  'success-light',
  'success-heavy',
  'error',
  'storm',
  'df1',
  'cute-bubble',
  'text',
]
let unlocked = false
let muted = false
let volume = 0.6
const base = new Map<SoundName, HTMLAudioElement>()
const last = new Map<SoundName, number>()
function loadPrefs() {
  try {
    muted = localStorage.getItem('r3os.muted') === '1'
    const v = Number(localStorage.getItem('r3os.volume'))
    if (Number.isFinite(v) && v >= 0 && v <= 1) volume = v
  } catch {}
}
loadPrefs()
export function initSound() {
  if (typeof Audio === 'undefined') return
  for (const n of names) {
    const a = new Audio(`/os/sfx/${n}.mp3`)
    a.preload = 'auto'
    base.set(n, a)
  }
  const unlock = () => {
    unlocked = true
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })
}
export function playSound(name: SoundName) {
  if (!unlocked || muted) return
  const now = performance.now()
  if (now - (last.get(name) ?? -999) < 80) return
  last.set(name, now)
  const src = base.get(name)
  if (!src) return
  const a = src.cloneNode(true) as HTMLAudioElement
  a.volume = volume
  void a.play().catch(() => {})
}
export function isMuted() {
  return muted
}
export function getVolume() {
  return volume
}
export function setMuted(v: boolean) {
  muted = v
  try {
    localStorage.setItem('r3os.muted', v ? '1' : '0')
  } catch {}
}
export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v))
  try {
    localStorage.setItem('r3os.volume', String(volume))
  } catch {}
}
