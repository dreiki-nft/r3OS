// Pure helpers for scripts/stranded-refunds.mjs (unit-tested; no network here).
//
// Who left MON behind in a Live Mode burner, and how much. Two kinds count:
//   * stranded: a burner whose latest session is over (expired or revoked) and that still holds more than dust;
//   * recovered late: MON the burner sent back to its owner when that was NOT a proper End session, i.e. not
//     "revoke while the session was still running, then sweep within END_SESSION_WINDOW blocks". That covers the
//     automatic sweep (r3OS reopened after the session expired) and any sweep done after expiry.
// MON that a later session in the same burner simply used up is not counted: it was spent on paint.
import { getAddress } from 'viem'

/** Revoke → sweep inside this many blocks (about 3 minutes) is the End session flow. */
export const END_SESSION_WINDOW = 600n
export const WEI = 10n ** 18n

const lower = (address) => String(address).toLowerCase()

/**
 * starts: [{ owner, burner, block, expiry }], revokes: [{ owner, burner, block }],
 * sweeps: [{ burner, to, block, value, hash }] (successful plain transfers from a burner, any recipient),
 * balances: Map(lower burner → wei), snapshot: block the balances were read at.
 * Returns one row per burner that owes something, and per-owner totals.
 */
export function classify({
  starts,
  revokes,
  sweeps,
  balances,
  snapshot,
  dust = WEI / 100n,
  exclude = [],
  endedBefore,
}) {
  const skip = new Set(exclude.map(lower))
  const sessionsByBurner = new Map()
  for (const start of starts) {
    const key = lower(start.burner)
    if (!sessionsByBurner.has(key)) sessionsByBurner.set(key, [])
    sessionsByBurner.get(key).push(start)
  }
  for (const list of sessionsByBurner.values())
    list.sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0))
  const revokesByPair = new Map()
  for (const revoke of revokes) {
    const key = `${lower(revoke.owner)}:${lower(revoke.burner)}`
    if (!revokesByPair.has(key)) revokesByPair.set(key, [])
    revokesByPair.get(key).push(revoke.block)
  }

  /** The session a block falls in (the last one started at or before it). */
  const sessionAt = (burner, block) => {
    const list = sessionsByBurner.get(lower(burner)) ?? []
    let found
    for (const session of list) if (session.block <= block) found = session
    return found
  }
  const revokedBetween = (session, from, to) =>
    (revokesByPair.get(`${lower(session.owner)}:${lower(session.burner)}`) ?? []).filter(
      (block) => block >= from && block <= to,
    )

  /** Where a session ended: its first revoke while it ran, else its expiry. */
  const endOf = (session) => {
    const revoked = revokedBetween(session, session.block, session.expiry)
    return revoked.length ? revoked.reduce((a, b) => (a < b ? a : b)) : session.expiry
  }
  // --ended-before: only sessions that were already over at that block count (e.g. before the automatic sweep
  // shipped). Later sessions end into the automatic sweep, so their MON comes back on the next visit.
  const counts = (session) => endedBefore == null || endOf(session) < endedBefore

  const rows = new Map()
  const row = (session) => {
    const key = lower(session.burner)
    if (!rows.has(key))
      rows.set(key, {
        owner: getAddress(session.owner),
        burner: getAddress(session.burner),
        sessions: (sessionsByBurner.get(key) ?? []).length,
        stranded: 0n,
        recovered: 0n,
        sweeps: [],
      })
    return rows.get(key)
  }

  for (const sweep of sweeps) {
    if (sweep.value <= 0n) continue
    const session = sessionAt(sweep.burner, sweep.block)
    if (!session || lower(sweep.to) !== lower(session.owner)) continue
    // Proper End session: revoked while the session was still running, swept right after.
    const revoked = revokedBetween(session, session.block, sweep.block).filter(
      (block) => block <= session.expiry,
    )
    const proper = revoked.some((block) => sweep.block - block <= END_SESSION_WINDOW)
    // Swept while the session still ran (and not by End session): someone emptied it deliberately. Not left behind.
    if (proper || sweep.block <= session.expiry || !counts(session)) continue
    const entry = row(session)
    entry.recovered += sweep.value
    entry.sweeps.push({ block: sweep.block, value: sweep.value, hash: sweep.hash })
  }

  for (const [key, list] of sessionsByBurner) {
    const latest = list[list.length - 1]
    const balance = balances.get(key) ?? 0n
    if (balance <= dust) continue
    const over = latest.expiry < snapshot || revokedBetween(latest, latest.block, snapshot).length > 0
    if (!over || !counts(latest)) continue
    row(latest).stranded += balance
  }

  const owners = new Map()
  for (const entry of rows.values()) {
    if (skip.has(lower(entry.owner))) continue
    const total = entry.stranded + entry.recovered
    if (total <= dust) continue
    const key = lower(entry.owner)
    if (!owners.has(key)) owners.set(key, { owner: entry.owner, stranded: 0n, recovered: 0n, burners: [] })
    const owner = owners.get(key)
    owner.stranded += entry.stranded
    owner.recovered += entry.recovered
    owner.burners.push(entry)
  }
  const list = [...owners.values()]
    .map((owner) => ({ ...owner, refund: roundUp(owner.stranded + owner.recovered) }))
    .sort((a, b) => (b.refund > a.refund ? 1 : b.refund < a.refund ? -1 : 0))
  return { owners: list, total: list.reduce((sum, owner) => sum + owner.refund, 0n) }
}

/** Rounds up to the next 0.001 MON. */
export function roundUp(wei, step = 10n ** 15n) {
  return ((wei + step - 1n) / step) * step
}

/** Wei → "1.234" (up to 3 decimals, as sent). */
export function mon(wei) {
  const whole = wei / WEI
  const fraction = ((wei % WEI) / 10n ** 15n).toString().padStart(3, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : `${whole}`
}

/** Decodes an Etherscan getLogs row of SessionStarted / SessionRevoked. */
export function decodeSessionLog(log) {
  const owner = getAddress(`0x${log.topics[1].slice(26)}`)
  const burner = getAddress(`0x${log.topics[2].slice(26)}`)
  const block = BigInt(log.blockNumber)
  const data = (log.data ?? '0x').slice(2)
  const expiry = data.length >= 64 ? BigInt(`0x${data.slice(0, 64)}`) : undefined
  return { owner, burner, block, expiry, hash: log.transactionHash }
}

/** Successful plain MON transfers sent by `burner`, from an Etherscan txlist. */
export function burnerSweeps(burner, txs) {
  const me = lower(burner)
  return txs
    .filter(
      (tx) =>
        lower(tx.from) === me &&
        tx.isError === '0' &&
        (tx.input === '0x' || tx.input === '') &&
        BigInt(tx.value) > 0n,
    )
    .map((tx) => ({
      burner: getAddress(burner),
      to: getAddress(tx.to),
      block: BigInt(tx.blockNumber),
      value: BigInt(tx.value),
      hash: tx.hash,
    }))
}
