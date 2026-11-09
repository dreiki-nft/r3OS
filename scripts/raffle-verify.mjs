#!/usr/bin/env node
/**
 * Re-does a raffle draw from public data and checks every step against the chain. Read-only.
 *   node scripts/raffle-verify.mjs                                   # the Storm Season raffle
 *   node scripts/raffle-verify.mjs docs/raffles/storm-season-1.json --rpc <url>
 *
 * 1. Rebuilds the ticket list from the published leaderboard (as scripts/storm-chasers.mjs does) and its hash.
 * 2. Reads the list actually loaded, from the loadTicketsBatch transactions' calldata, and the hash passed to
 *    initSnapshot, and checks all three agree. (The contract stores snapshotHash but does not check it.)
 * 3. Reads every event the raffle contract emitted during the draw and checks there was exactly one request, one
 *    random number, one winner, no prize recovery (no re-roll) and one claim, to the winner.
 * 4. Recomputes random % tickets → ticket → wallet with the contract's own rules (team wallets skipped).
 * 5. Checks the prize NFT went from the raffle to that wallet.
 */
import { readFileSync } from 'node:fs'
import { createPublicClient, decodeEventLog, decodeFunctionData, http, parseAbi } from 'viem'
import { chunks } from './community-stats-lib.mjs'
import { checkHistory, findWinner, fingerprint, ticketLines, winningTicket } from './raffle-lib.mjs'

const argv = process.argv.slice(2)
const recordPath = argv.find((arg) => arg.endsWith('.json')) ?? 'docs/raffles/storm-season-1.json'
const rpc = argv.includes('--rpc') ? argv[argv.indexOf('--rpc') + 1] : 'https://rpc.monad.xyz'
const record = JSON.parse(readFileSync(recordPath, 'utf8'))
const { abi } = JSON.parse(readFileSync('contracts/deployed/R3tardsRaffle.json', 'utf8'))
const TRANSFER = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
])
const client = createPublicClient({ transport: http(rpc, { retryCount: 4, retryDelay: 400 }) })

let failed = 0
const check = (ok, label, detail = '') => {
  if (!ok) failed += 1
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `: ${detail}` : ''}`)
}

try {
  // 1. The published list.
  const board = JSON.parse(readFileSync(record.ticketList.source, 'utf8'))
  const published = board.wallets
    .map((wallet) => ({ address: wallet.address.toLowerCase(), tickets: wallet.storms.length }))
    .sort((a, b) => (a.address < b.address ? -1 : 1))
  let running = 0
  const publishedCum = published.map((entry) => (running += entry.tickets))
  const publishedLines = ticketLines(
    published.map((entry) => entry.address),
    publishedCum,
  )
  const publishedHash = fingerprint(publishedLines)
  check(
    publishedHash === record.ticketList.snapshotHash,
    'published ticket list matches the recorded fingerprint',
    publishedHash,
  )

  // 2. What was loaded onchain, from the transactions themselves.
  const txs = Object.fromEntries(
    await Promise.all(
      record.transactions.map(async (tx) => [tx.step, await client.getTransaction({ hash: tx.hash })]),
    ),
  )
  const init = decodeFunctionData({ abi, data: txs.initSnapshot.input })
  check(
    String(init.args[1]).toLowerCase() === record.ticketList.snapshotHash &&
      String(init.args[0]) === record.ticketList.snapshotBlock,
    'initSnapshot committed to that fingerprint and snapshot block',
  )
  const loaded = { wallets: [], cum: [] }
  let total = 0n
  for (const tx of record.transactions.filter((t) => t.step === 'loadTicketsBatch')) {
    const { args } = decodeFunctionData({ abi, data: txs[tx.step].input })
    args[0].forEach((wallet, i) => {
      total += BigInt(args[1][i])
      loaded.wallets.push(wallet.toLowerCase())
      loaded.cum.push(total)
    })
  }
  const loadedHash = fingerprint(ticketLines(loaded.wallets, loaded.cum))
  check(
    loadedHash === record.ticketList.snapshotHash,
    'the list loaded onchain hashes to the same fingerprint',
    `${loaded.wallets.length} wallets, ${total} tickets`,
  )

  // 3. Every event the raffle emitted while it ran.
  const logs = []
  for (const range of chunks(BigInt(record.window.fromBlock), BigInt(record.window.toBlock), 100))
    logs.push(...(await client.getLogs({ address: record.contract, ...range })))
  const events = logs.map((log) => {
    const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics })
    return { name: decoded.eventName, args: decoded.args }
  })
  const history = checkHistory(events)
  check(
    history.ok,
    'one snapshot, one request, one random number, one winner, no re-roll, one claim',
    history.problems.join('; '),
  )

  // 4. The arithmetic.
  const ticket = winningTicket(history.random, total)
  const { winner, skipped } = findWinner(loaded.wallets, loaded.cum, ticket)
  check(
    ticket === history.ticket && ticket === BigInt(record.result.winningTicket),
    'random number mod tickets gives the recorded ticket',
    `${history.random} mod ${total} = ${ticket}`,
  )
  check(
    winner === history.winner && winner === record.result.winner.toLowerCase(),
    "that ticket's wallet (team wallets skipped) is the recorded winner",
    `${winner}${skipped ? ` (${skipped} team wallet${skipped === 1 ? '' : 's'} skipped)` : ''}`,
  )

  // 5. The prize.
  const claim = await client.getTransactionReceipt({
    hash: record.transactions.find((t) => t.step === 'claimPrize').hash,
  })
  const moved = claim.logs
    .filter((log) => log.address.toLowerCase() === record.prize.nft.toLowerCase())
    .map((log) => decodeEventLog({ abi: TRANSFER, data: log.data, topics: log.topics }).args)
    .find((args) => args.tokenId === BigInt(record.prize.tokenId))
  check(
    claim.status === 'success' &&
      moved?.from.toLowerCase() === record.contract.toLowerCase() &&
      moved?.to.toLowerCase() === winner,
    `prize #${record.prize.tokenId} went from the raffle to the winner`,
  )

  console.log(failed ? `\n${failed} check(s) failed` : '\nthe draw checks out')
  process.exit(failed ? 1 : 0)
} catch (error) {
  console.error(
    `raffle-verify failed: ${String(error?.shortMessage ?? error?.message ?? error).replace(/https?:\/\/\S+/g, '[rpc]')}`,
  )
  process.exit(1)
}
