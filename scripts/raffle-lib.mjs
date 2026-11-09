/**
 * The R3tardsRaffle arithmetic, mirrored from the verified source (contracts/deployed/R3tardsRaffle.sol), so a
 * draw can be re-done by anyone from public data. Pure functions; raffle-verify.mjs feeds them chain reads.
 *
 * The contract stores wallets[] and cumTickets[] (running totals). Wallet i holds tickets
 * [cumTickets[i-1], cumTickets[i] - 1]. fulfillDraw picks ticket = uint256(random) % totalTickets, then the
 * first wallet whose running total is above it, skipping team wallets forward (wrapping around).
 * Note: the contract stores snapshotHash but does not check it; the verifier does, against the list it reads.
 */
import { keccak256 } from 'viem'

/** The contract's team wallets (_isTeamWallet): never a winner, the only ones allowed to deposit a prize. */
export const TEAM = [
  '0x40ea55e0b8f02f8ebc9d91e082e202ed988647fa', // DEPLOYER
  '0xdfc19dd5f80048df12d7a71cb01226f8ce24a954', // COMMUNITY_TREASURY
  '0x18d5346216315667c51d69f346e3c768136f8018', // ACTIVATION
  '0xf10ed040f182511ef2179adea749920881a4eef9', // PARTNERS
  '0xec823eaffa4584f482a0d9c3e634840d14066242', // TEAM_LOCK
]

/** wallets[] + cumTickets[] → one address per ticket, in ticket order (the published storm-chasers.txt). */
export function ticketLines(wallets, cumTickets) {
  if (wallets.length !== cumTickets.length) throw new Error('wallets and cumTickets differ in length')
  const lines = []
  let previous = 0n
  wallets.forEach((wallet, i) => {
    const cum = BigInt(cumTickets[i])
    if (cum <= previous) throw new Error(`wallet ${i} has no tickets`)
    for (let t = previous; t < cum; t++) lines.push(wallet.toLowerCase())
    previous = cum
  })
  return lines
}

/** keccak256 of the 20-byte addresses concatenated in ticket order: what snapshotHash commits to. */
export function fingerprint(lines) {
  return keccak256(`0x${lines.map((address) => address.slice(2).toLowerCase()).join('')}`)
}

/** fulfillDraw's ticket: uint256(random) % totalTickets. */
export function winningTicket(random, totalTickets) {
  return BigInt(random) % BigInt(totalTickets)
}

/** _findWinner, step for step: binary search for the first running total above the ticket, then skip team. */
export function findWinner(wallets, cumTickets, ticket, team = TEAM) {
  if (!wallets.length) throw new Error('no wallets')
  const cum = cumTickets.map(BigInt)
  const t = BigInt(ticket)
  let lo = 0
  let hi = cum.length - 1
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    if (cum[mid] <= t) lo = mid + 1
    else hi = mid
  }
  for (let i = 0; i < wallets.length; i++) {
    const idx = (lo + i) % wallets.length
    if (!team.includes(wallets[idx].toLowerCase()))
      return { winner: wallets[idx].toLowerCase(), index: idx, skipped: i }
  }
  throw new Error('NoEligibleWinner')
}

/**
 * The raffle's own events between the snapshot and the claim, in order, checked for a clean single draw:
 * exactly one request, one randomness callback, one winner, no prize recovered (a recovery after the random
 * number is public would allow a re-roll), and the claim going to the drawn winner.
 * events: [{ name, args }] decoded from the raffle contract's logs.
 */
export function checkHistory(events) {
  const named = (name) => events.filter((event) => event.name === name)
  const zero = '0x0000000000000000000000000000000000000000'
  const draws = named('DrawComplete')
  const callbacks = draws.filter((event) => String(event.args.winner).toLowerCase() === zero)
  const results = draws.filter((event) => String(event.args.winner).toLowerCase() !== zero)
  const problems = []
  if (named('SnapshotFinalized').length !== 1)
    problems.push(`${named('SnapshotFinalized').length} snapshot finalizations (expected 1)`)
  if (named('DrawRequested').length !== 1)
    problems.push(`${named('DrawRequested').length} draw requests (expected 1)`)
  if (callbacks.length !== 1) problems.push(`${callbacks.length} randomness callbacks (expected 1)`)
  if (results.length !== 1) problems.push(`${results.length} winners drawn (expected 1)`)
  if (named('PrizeRecovered').length)
    problems.push('the prize was recovered during the raffle (a re-roll is possible)')
  const result = results[0]
  const callback = callbacks[0]
  if (result && callback && result.args.randomNumber !== callback.args.randomNumber)
    problems.push('the winner was drawn from a different random number than Pyth delivered')
  const claims = named('PrizeClaimed')
  if (claims.length !== 1) problems.push(`${claims.length} prize claims (expected 1)`)
  else if (result && String(claims[0].args.winner).toLowerCase() !== String(result.args.winner).toLowerCase())
    problems.push('the prize was claimed for someone other than the drawn winner')
  return {
    ok: problems.length === 0,
    problems,
    random: callback?.args.randomNumber,
    winner: result ? String(result.args.winner).toLowerCase() : undefined,
    ticket: result ? BigInt(result.args.winningTicket) : undefined,
  }
}
