/** Fit sizes move in steps of 16 px (1/16 of the canvas). */
export const FIT_STEP = 16
/** Grow only when this much more room is there, so text that wraps a line differently never makes it pulse. */
export const FIT_GROW_SLACK = 48
const FIT_MIN = 128

/**
 * The next "zoom to fit" canvas size. The space Paint gives the canvas changes by a line whenever text above
 * or below it wraps differently (a painter's name, the cost line). Following it exactly made the canvas
 * twitch, so: shrink at once when the canvas would be cut off, grow only when there is clearly more room,
 * otherwise keep the current size.
 */
export function nextFitSize(current: number, available: number) {
  const snapped = Math.max(FIT_MIN, Math.floor(available / FIT_STEP) * FIT_STEP)
  if (current > available) return snapped
  if (available - current >= FIT_GROW_SLACK) return snapped
  return current
}
