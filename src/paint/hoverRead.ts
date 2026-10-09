/**
 * Pacing for Paint's "under cursor" tile readout. It is informational, but it used to re-read the hovered tile
 * every 10 blocks and on every new tile the pointer crossed. At a paint party the tile under a resting cursor
 * is repainted (and goes stale) almost every block, so each open Paint window could send ~2 reads a second,
 * and everyone on the venue wifi shares one IP's public-RPC rate limit. Now: read a new tile once the pointer
 * settles on it, and re-read the same tile at most every HOVER_REFRESH_MS.
 */
export const HOVER_SETTLE_MS = 250
export const HOVER_REFRESH_MS = 6_000

/** How long to wait before reading `tile`, given the last read. */
export function hoverReadDelay(tile: number, last: { tile: number; at: number }, now: number) {
  if (tile !== last.tile) return HOVER_SETTLE_MS
  return Math.max(0, last.at + HOVER_REFRESH_MS - now)
}
