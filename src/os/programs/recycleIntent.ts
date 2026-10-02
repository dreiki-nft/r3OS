/**
 * "Recycle this frame" requests from inside the app (My Frames, a frame dragged onto the desktop Bin). They
 * travel in memory, never in the URL: a shared link must not be able to open the irreversible burn dialog
 * with a frame of the attacker's choosing.
 */
type Listener = () => void

let pending: number | undefined
const listeners = new Set<Listener>()

export function requestRecycle(frameId: number) {
  if (!Number.isSafeInteger(frameId) || frameId <= 0) return
  pending = frameId
  for (const listener of listeners) listener()
}

/** The pending request, consumed once. */
export function takeRecycleRequest() {
  const id = pending
  pending = undefined
  return id
}

export function subscribeRecycleRequests(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** "frame #3", "frames #3, #7 and #9", "frames #1, #2, #3 and 4 more". */
export function describeFrames(ids: readonly number[]) {
  if (!ids.length) return 'no frames'
  const shown = ids.slice(0, 3).map((id) => `#${id}`)
  if (ids.length === 1) return `frame ${shown[0]}`
  if (ids.length <= 3) return `frames ${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
  return `frames ${shown.join(', ')} and ${ids.length - 3} more`
}
