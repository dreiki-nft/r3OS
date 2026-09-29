import { useSyncExternalStore } from 'react'
import { getBlockSnapshot, subscribeBlocks } from './blocks'

type Listener = () => void

type TickState = {
  width: number
  value: number
  lastBucket: bigint
  listeners: Set<Listener>
  stopBlocks?: () => void
  onVisible?: () => void
}

const states = new Map<number, TickState>()

function hidden() {
  return typeof document !== 'undefined' && document.hidden
}

function notify(state: TickState) {
  state.value += 1
  for (const listener of state.listeners) listener()
}

function processBlock(state: TickState, block: bigint, isHidden = hidden()) {
  if (isHidden) return false
  const bucket = block / BigInt(state.width)
  if (bucket === state.lastBucket) return false
  state.lastBucket = bucket
  notify(state)
  return true
}

function stateFor(everyBlocks: number) {
  const width = Math.max(1, Math.floor(everyBlocks))
  let state = states.get(width)
  if (state) return state
  state = {
    width,
    value: 0,
    lastBucket: getBlockSnapshot().block / BigInt(width),
    listeners: new Set(),
  }
  states.set(width, state)
  return state
}

function visibleTick(state: TickState, block = getBlockSnapshot().block) {
  state.lastBucket = block / BigInt(state.width)
  notify(state)
}

function start(state: TickState) {
  if (state.stopBlocks) return
  state.lastBucket = getBlockSnapshot().block / BigInt(state.width)
  state.stopBlocks = subscribeBlocks(() => {
    processBlock(state, getBlockSnapshot().block)
  })
  if (typeof document !== 'undefined') {
    state.onVisible = () => {
      if (document.hidden) return
      visibleTick(state)
    }
    document.addEventListener('visibilitychange', state.onVisible)
  }
}

function stopIfUnused(state: TickState) {
  if (state.listeners.size) return
  state.stopBlocks?.()
  state.stopBlocks = undefined
  if (state.onVisible && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', state.onVisible)
  }
  state.onVisible = undefined
}

export function bumpRefresh() {
  for (const state of states.values()) notify(state)
}

export function useRefreshTick(everyBlocks = 10) {
  const state = stateFor(everyBlocks)
  return useSyncExternalStore(
    (listener) => {
      state.listeners.add(listener)
      start(state)
      return () => {
        state.listeners.delete(listener)
        stopIfUnused(state)
      }
    },
    () => state.value,
    () => state.value,
  )
}

export function __refreshTickStateForTests(everyBlocks = 10) {
  return stateFor(everyBlocks)
}

export function __processRefreshBlockForTests(everyBlocks: number, block: bigint, isHidden = false) {
  return processBlock(stateFor(everyBlocks), block, isHidden)
}

export function __visibleRefreshForTests(everyBlocks: number, block: bigint) {
  visibleTick(stateFor(everyBlocks), block)
}

export function __resetRefreshTickForTests() {
  for (const state of states.values()) {
    state.stopBlocks?.()
    if (state.onVisible && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', state.onVisible)
    }
  }
  states.clear()
}
