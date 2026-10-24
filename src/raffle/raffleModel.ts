/**
 * RAFFLE.EXE's logic, kept pure so every claim it makes is tested:
 *  - the Storm Season ticket list, rebuilt from the public leaderboard file exactly as scripts/storm-chasers.mjs
 *    builds it (wallets sorted by address, one line per ticket), and its keccak256 fingerprint, which is what the
 *    raffle contract stores as snapshotHash;
 *  - which ticket a Pyth Entropy random number picks and whose ticket that is (team wallets skipped, like the
 *    contract's _findWinner).
 * The raffle contract is R3tardsRaffle (verified): initSnapshot → loadTicketsBatch → finalizeSnapshot → prize →
 * setDrawDeadline → requestDraw (Pyth Entropy) → callback → fulfillDraw → claimPrize.
 */
import { keccak256, parseAbi, type Hex } from 'viem'

export const RAFFLE_ADDRESS = '0x478844840df2096Ca08AF5ce8a5CdC632493228f'
export const RAFFLE_SOURCE_URL =
  'https://monadscan.com/address/0x478844840df2096ca08af5ce8a5cdc632493228f#code'
export const RAFFLE_ABI = parseAbi([
  'function getRaffleInfo() view returns (uint256 totalTickets, uint256 walletCount, uint256 snapshotBlock, bytes32 snapshotHash, address prizeNFT, uint256 prizeTokenId, address prizeDepositor, uint256 drawDeadline)',
  'function getRaffleState() view returns (uint8 state, uint64 sequenceNumber, bytes32 rawRandomNumber, address winner, uint256 winningTicket, bool prizeDeposited, bool prizeClaimed)',
])

/** The contract's constant team wallets: never picked as winner (its _isTeamWallet). */
export const TEAM_WALLETS = [
  '0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA',
  '0xdfC19DD5f80048dF12D7a71cB01226F8ce24a954',
  '0x18D5346216315667C51D69F346E3C768136F8018',
  '0xf10eD040f182511ef2179AdeA749920881A4eef9',
  '0xec823eAffA4584f482a0d9c3E634840d14066242',
].map((address) => address.toLowerCase())

export const STATE_NAMES = [
  'Pending',
  'LoadingSnapshot',
  'SnapshotLoaded',
  'PrizeDeposited',
  'DrawRequested',
  'RandomnessReceived',
  'Complete',
] as const

export type Entry = { address: string; tickets: number; from: number; to: number }

/** Board wallets → the raffle's ticket ranges, in the contract's order (sorted by address). */
export function ticketRanges(wallets: readonly { address: string; tickets: number }[]): Entry[] {
  const sorted = [...wallets].sort((a, b) => (a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1))
  let next = 0
  return sorted.map(({ address, tickets }) => {
    const entry = { address, tickets, from: next, to: next + tickets - 1 }
    next += tickets
    return entry
  })
}

/** The published ticket list: one address per ticket, in order (storm-chasers.txt). */
export function ticketLines(entries: readonly Entry[]) {
  return entries.flatMap((entry) => Array.from({ length: entry.tickets }, () => entry.address))
}

/** keccak256 of the 20-byte addresses concatenated in ticket order: the contract's snapshotHash. */
export function fingerprint(entries: readonly Entry[]): Hex {
  return keccak256(
    `0x${ticketLines(entries)
      .map((address) => address.slice(2).toLowerCase())
      .join('')}`,
  )
}

/** The wallet holding a ticket number, skipping team wallets forward like the contract does. */
export function holderOf(entries: readonly Entry[], ticket: number) {
  const at = entries.findIndex((entry) => ticket >= entry.from && ticket <= entry.to)
  if (at < 0) return undefined
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[(at + i) % entries.length]
    if (!TEAM_WALLETS.includes(entry.address.toLowerCase())) return { entry, skipped: i }
  }
  return undefined
}

/** random mod total tickets: the winning ticket number, as fulfillDraw computes it. */
export function winningTicket(random: Hex, totalTickets: number) {
  return Number(BigInt(random) % BigInt(totalTickets))
}

export type Step = { key: string; label: string; done: boolean }

/**
 * Where the Storm Season raffle is. `onchainIsSeason` = the contract's snapshotHash is this season's list;
 * until then the contract may still show an earlier raffle.
 */
export function steps(
  stormsDone: number,
  totalStorms: number,
  state: number | undefined,
  onchainIsSeason: boolean,
) {
  const at = (n: number) => onchainIsSeason && state != null && state >= n
  const list: Step[] = [
    {
      key: 'tickets',
      label: `Tickets from storms (${stormsDone} of ${totalStorms})`,
      done: stormsDone >= totalStorms,
    },
    { key: 'locked', label: 'Ticket list locked in the contract', done: at(2) },
    { key: 'prize', label: 'Prize deposited in the contract', done: at(3) },
    { key: 'request', label: 'Randomness requested from Pyth Entropy', done: at(4) },
    { key: 'random', label: 'Random number delivered onchain', done: at(5) },
    { key: 'winner', label: 'Winner drawn', done: at(6) },
  ]
  return list
}
