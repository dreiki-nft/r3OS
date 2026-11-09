/**
 * What coordinated wallets can do to r3OS, priced with the Paint contract's real rules and the fees measured on
 * mainnet. Pure functions; scripts/sybil-sim.mjs prints the tables, docs/SYBIL_REVIEW.md explains them.
 *
 * Contract rules used (R3OSPaint, chain 143 deployment values, docs/TECHNICAL.md):
 *  - budget per wallet: 512 units an hour for a new wallet (+32 per active day, max 2,048); painting a blank
 *    pixel or one's own wet pixel costs 1 unit, overwriting a dry pixel costs 2.
 *  - tile heat (16×16 tiles, shared by everyone): +1 per blank, +2 per dry pixel, max 512, cooling 2 per block.
 *  - region cap (64×64 regions): at most 512 changed pixels per region per block.
 */
export const RULES = {
  canvasPixels: 65_536,
  tiles: 256,
  regions: 16,
  unitsPerHourNewWallet: 512,
  dryCost: 2,
  maxTileHeat: 512,
  tileCoolingPerBlock: 2,
  regionPixelsPerBlock: 512,
  secondsPerBlock: 0.4,
}

/** Fees measured on mainnet (scripts/battle-spend.mjs, season 2): MON per paint transaction, funding transfer. */
export const FEES = {
  paintTx: 0.03, // average human paint transaction, season 2 (359.3 MON / 12,216 txs)
  bigPaintTx: 0.1, // a conservative price for one full-budget stroke (256+ pixels)
  fundTransfer: 0.0021, // 21,000 gas at ~102 gwei: sending a fresh wallet its MON
  monUsd: 0.0166, // CoinGecko, November 7, 2026
}

const usd = (mon) => Math.round(mon * FEES.monUsd * 100) / 100

/**
 * Overwriting `share` of an already-painted canvas with `wallets` fresh wallets: how long their budgets need,
 * the floor the region cap puts on it, and what it costs in fees.
 */
export function griefing(wallets, { share = 1, rules = RULES, fees = FEES } = {}) {
  const pixels = Math.round(rules.canvasPixels * share)
  const units = pixels * rules.dryCost
  const unitsPerHour = wallets * rules.unitsPerHourNewWallet
  const hoursByBudget = units / unitsPerHour
  const minSecondsByRegionCap =
    Math.ceil(pixels / (rules.regions * rules.regionPixelsPerBlock)) * rules.secondsPerBlock
  const seconds = Math.max(hoursByBudget * 3_600, minSecondsByRegionCap)
  const strokes = Math.ceil(units / rules.unitsPerHourNewWallet) // one full-budget stroke per wallet-hour
  const mon = wallets * fees.fundTransfer + strokes * fees.bigPaintTx
  return {
    wallets,
    pixels,
    hours: Math.round((seconds / 3_600) * 100) / 100,
    strokes,
    mon: Math.round(mon * 100) / 100,
    usd: usd(mon),
  }
}

/** After a tile is burst to max heat, how many dry pixels per minute everyone together can still change there. */
export function sustainedDryPixelsPerTilePerMinute(rules = RULES) {
  return Math.round(((rules.tileCoolingPerBlock / rules.dryCost) * 60) / rules.secondsPerBlock)
}

/**
 * Per-wallet tickets (1 per storm painted in): `sybils` throwaway wallets painting one pixel in every storm
 * against the honest tickets of Storm Season.
 */
export function stormRaffle(sybils, { storms = 21, honestTickets = 156, fees = FEES } = {}) {
  const tickets = sybils * storms
  const odds = tickets / (tickets + honestTickets)
  const mon = sybils * (fees.fundTransfer + storms * fees.paintTx)
  return {
    sybils,
    tickets,
    winChance: Math.round(odds * 1_000) / 1_000,
    mon: Math.round(mon * 100) / 100,
    usd: usd(mon),
  }
}

/**
 * AGENT.EXE-style economics: the war chest pays `taxPerPixel` per damage pixel pro rata, and a human pays fees
 * per damage pixel. Splitting damage over several wallets never raises a pro-rata share or a rank by MON
 * burned; it only multiplies per-wallet rewards (badges).
 */
export function battleEconomics({ chest = 1_333, damage = 166_626, humanFeesMon = 500 } = {}) {
  const paidPerPixel = chest / damage
  const costPerPixel = humanFeesMon / damage
  return {
    paidPerPixel: Math.round(paidPerPixel * 10_000) / 10_000,
    feePerPixel: Math.round(costPerPixel * 10_000) / 10_000,
    returnPerMonOfFees: Math.round((paidPerPixel / costPerPixel) * 100) / 100,
  }
}

/** A pro-rata share is the same whether one wallet or many did the damage. */
export function proRataShare(damages, chest) {
  const total = damages.reduce((a, b) => a + b, 0)
  return damages.map((d) => (chest * d) / total)
}
