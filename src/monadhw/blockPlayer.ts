import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { getVolume, isMuted, subscribeSoundSettings } from '../os/sound'
import { blockNote } from './blockNote'

type Listener = () => void
const listeners = new Set<Listener>()
let playing = false
let audio: AudioContext | undefined
let stopBlocks: (() => void) | undefined
let stopSound: (() => void) | undefined
let lastBlock = 0n

function emit() {
  for (const listener of listeners) listener()
}

export function getBlockPlayerPlaying() {
  return playing
}

export function subscribeBlockPlayer(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function context() {
  if (audio) return audio
  const Constructor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Constructor) return undefined
  audio = new Constructor()
  return audio
}

function playLatest() {
  if (!playing || isMuted() || document.hidden) return
  const block = getBlockSnapshot()
  const volume = getVolume()
  if (volume <= 0 || block.block === 0n || block.block === lastBlock || !block.hash) return
  lastBlock = block.block
  const ctx = context()
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  const note = blockNote(block)
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  const now = ctx.currentTime
  oscillator.type = note.wave
  oscillator.frequency.value = 440 * 2 ** ((note.midi - 69) / 12)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.linearRampToValueAtTime(Math.max(0.0001, note.gain * volume), now + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17)
  oscillator.connect(gain)
  gain.connect(ctx.destination)
  oscillator.start(now)
  oscillator.stop(now + 0.18)
}

function onVisibility() {
  if (document.hidden) stopBlockPlayer()
}

export function startBlockPlayer() {
  if (playing || isMuted() || document.hidden) return false
  const ctx = context()
  if (!ctx) return false
  // startBlockPlayer is called directly from the Listen button's user gesture. Resume here while
  // the browser still considers the call user-initiated; waiting for the next block can lose that privilege.
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
  playing = true
  lastBlock = getBlockSnapshot().block
  stopBlocks = subscribeBlocks(playLatest)
  stopSound = subscribeSoundSettings(() => {
    if (isMuted()) stopBlockPlayer()
  })
  document.addEventListener('visibilitychange', onVisibility)
  emit()
  return true
}

export function stopBlockPlayer() {
  if (!playing && !audio) return
  playing = false
  stopBlocks?.()
  stopBlocks = undefined
  stopSound?.()
  stopSound = undefined
  document.removeEventListener('visibilitychange', onVisibility)
  if (audio) {
    void audio.close().catch(() => undefined)
    audio = undefined
  }
  emit()
}

export function toggleBlockPlayer() {
  return playing ? (stopBlockPlayer(), false) : startBlockPlayer()
}
