/**
 * Plain-language explanations for paint refusals. The heat math uses the core constants already loaded
 * by Paint and the browser's observed block cadence. The fallback is only used before a cadence exists.
 */
import type { PaintCost } from './cost'

export interface HeatRuleConstants {
  MAX_TILE_HEAT: bigint
  TILE_COOLDOWN_PER_BLOCK: bigint
}

const FALLBACK_BLOCK_MS = 300

function blockMsOrDefault(blockMs: number) {
  return Number.isFinite(blockMs) && blockMs > 0 ? blockMs : FALLBACK_BLOCK_MS
}

/** Blocks → "14 s", "1:17", "5:00", "17 h". */
export function formatWait(blocks: number, blockMs: number) {
  const seconds = Math.max(1, Math.ceil((blocks * blockMsOrDefault(blockMs)) / 1_000))
  if (seconds < 60) return `${seconds} s`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return `${Math.round(seconds / 3_600)} h`
}

/**
 * Explain the worst overheating tile in a stroke. The time is deliberately approximate: the tile can
 * receive more paint before the user retries, and block cadence is an observed browser value.
 */
export function overheatReason(
  overheat: PaintCost['overheat'],
  constants: HeatRuleConstants,
  blockMs: number,
) {
  if (!overheat.length) return undefined

  const maxHeat = Number(constants.MAX_TILE_HEAT)
  const drainPerBlock = Math.max(1, Number(constants.TILE_COOLDOWN_PER_BLOCK))

  const tooLarge = overheat.find((entry) => entry.add > maxHeat)
  if (tooLarge) {
    return `tile ${tooLarge.tile}: this stroke adds ${tooLarge.add} heat but the tile only holds ${maxHeat}. paint it in smaller steps.`
  }

  const waitBlocks = (entry: PaintCost['overheat'][number]) =>
    Math.ceil((entry.heat + entry.add - maxHeat) / drainPerBlock)
  const worst = overheat.reduce((current, entry) =>
    waitBlocks(entry) > waitBlocks(current) ? entry : current,
  )
  const more = overheat.length > 1 ? ` (+${overheat.length - 1} more hot)` : ''

  return `tile ${worst.tile} is hot (${worst.heat}/${maxHeat}). try again in ~${formatWait(waitBlocks(worst), blockMs)} if it stays quiet${more}.`
}
