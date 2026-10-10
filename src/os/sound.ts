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
/** Half volume until the person picks their own in Sounds (saved per device). */
export const DEFAULT_VOLUME = 0.5
let volume = DEFAULT_VOLUME
const base = new Map<SoundName, HTMLAudioElement>()
/*
 * Sounds play through Web Audio when it's available: iPhones ignore HTMLAudioElement.volume (it's always
 * 100% there), but a GainNode works everywhere. Plain <audio> stays as the fallback.
 */
let context: AudioContext | undefined
/* A new key: the old 'r3os.volume' often held a 0 saved by the bug below, so everyone restarts at 50%. */
const VOLUME_KEY = 'r3os.soundVolume'
const buffers = new Map<SoundName, AudioBuffer>()
const last = new Map<SoundName, number>()
const settingListeners = new Set<() => void>()
function loadPrefs() {
  try {
    muted = localStorage.getItem('r3os.muted') === '1'
    // No saved value must mean the default, not 0 (Number(null) is 0, which used to silence new visitors).
    const saved = localStorage.getItem(VOLUME_KEY)
    const v = saved === null || saved.trim() === '' ? NaN : Number(saved)
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
  // iPhones only let audio start inside certain gestures (touchend/click), so listen to all of them.
  const events = ['pointerdown', 'touchend', 'click', 'keydown'] as const
  const unlock = () => {
    unlocked = true
    for (const name of events) window.removeEventListener(name, unlock)
    startWebAudio()
  }
  for (const name of events) window.addEventListener(name, unlock)
}
/** Called inside the first tap/keypress, which browsers require before audio may start. */
function startWebAudio() {
  if (context || typeof window === 'undefined' || typeof fetch !== 'function') return
  const Constructor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Constructor) return
  try {
    context = new Constructor()
  } catch {
    return
  }
  void context.resume?.().catch(() => {})
  for (const name of names) {
    void fetch(`/os/sfx/${name}.mp3`)
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error('sfx'))))
      .then((data) => context!.decodeAudioData(data))
      .then((buffer) => buffers.set(name, buffer))
      .catch(() => {})
  }
}

export function playSound(name: SoundName) {
  if (!unlocked || muted) return
  const now = performance.now()
  if (now - (last.get(name) ?? -999) < 80) return
  last.set(name, now)
  const buffer = buffers.get(name)
  if (context && buffer && context.state !== 'closed') {
    try {
      if (context.state === 'suspended') void context.resume().catch(() => {})
      const source = context.createBufferSource()
      const gain = context.createGain()
      gain.gain.value = volume
      source.buffer = buffer
      source.connect(gain).connect(context.destination)
      source.start()
      return
    } catch {
      // fall through to <audio>
    }
  }
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
export function subscribeSoundSettings(listener: () => void) {
  settingListeners.add(listener)
  return () => settingListeners.delete(listener)
}

function emitSoundSettings() {
  for (const listener of settingListeners) listener()
}

export function setMuted(v: boolean) {
  muted = v
  try {
    localStorage.setItem('r3os.muted', v ? '1' : '0')
  } catch {}
  emitSoundSettings()
}
export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v))
  try {
    localStorage.setItem(VOLUME_KEY, String(volume))
  } catch {}
  emitSoundSettings()
}
