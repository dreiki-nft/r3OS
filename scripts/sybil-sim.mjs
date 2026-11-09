#!/usr/bin/env node
/**
 * Adversarial simulations to run before any prize-bearing event: what 10, 100 and 1,000 coordinated wallets
 * can do, priced with the Paint contract's rules and measured mainnet fees (scripts/sybil-model-lib.mjs).
 *   node scripts/sybil-sim.mjs
 *   node scripts/sybil-sim.mjs --mon-usd 0.02 --storms 21 --honest-tickets 156
 * Offline and read-only. Explained in docs/SYBIL_REVIEW.md.
 */
import {
  FEES,
  battleEconomics,
  griefing,
  proRataShare,
  stormRaffle,
  sustainedDryPixelsPerTilePerMinute,
} from './sybil-model-lib.mjs'

const argv = process.argv.slice(2)
const flag = (name, fallback) => (argv.includes(name) ? Number(argv[argv.indexOf(name) + 1]) : fallback)
const fees = { ...FEES, monUsd: flag('--mon-usd', FEES.monUsd) }
const storms = flag('--storms', 21)
const honestTickets = flag('--honest-tickets', 156)
const sizes = [10, 100, 1_000]

console.log('Canvas griefing: overwrite the whole painted canvas with fresh wallets')
console.log('wallets | hours | full-budget strokes | MON | USD')
for (const n of sizes) {
  const g = griefing(n, { fees })
  console.log(`${n} | ${g.hours} | ${g.strokes} | ${g.mon} | $${g.usd}`)
}
console.log(
  `after a burst, each tile takes at most ~${sustainedDryPixelsPerTilePerMinute()} dry pixels a minute from everyone together\n`,
)

console.log(`Per-wallet raffle tickets (1 per storm, ${storms} storms, ${honestTickets} honest tickets)`)
console.log('throwaway wallets | tickets | chance to win | MON | USD')
for (const n of sizes) {
  const s = stormRaffle(n, { storms, honestTickets, fees })
  console.log(`${n} | ${s.tickets} | ${Math.round(s.winChance * 100)}% | ${s.mon} | $${s.usd}`)
}

const b = battleEconomics()
console.log('\nAGENT.EXE war chest (pro rata to damage)')
console.log(
  `paid ${b.paidPerPixel} MON per damage pixel, fees ~${b.feePerPixel} MON per damage pixel: ${b.returnPerMonOfFees}x back`,
)
const one = proRataShare([1_000, 3_000], 1_333)
const split = proRataShare([500, 500, 3_000], 1_333)
console.log(
  `splitting 1,000 damage over 2 wallets: ${Math.round(one[0])} MON vs ${Math.round(split[0] + split[1])} MON (no gain)`,
)
