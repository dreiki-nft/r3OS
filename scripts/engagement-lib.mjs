/**
 * Community engagement from paint records alone (owner, block, time, pixels), so every number can be rebuilt
 * from the Paint contract's public `Painted` events. Pure functions; community-stats.mjs feeds them.
 *
 * Definitions (also published with the numbers, see DEFINITIONS):
 *  - day: a UTC calendar day; week: 7 UTC days starting on Monday.
 *  - active wallet: painted at least once in that day/week.
 *  - cohort: the wallets whose first paint in the data fell on the same UTC day.
 *  - Dn retention: the share of a cohort that painted again exactly n days after its first day. A cohort only
 *    counts for Dn once day first+n is fully over (inside the coverage), so young cohorts never drag a rate down.
 *  - concentration: how much of all paints (or pixels) the busiest wallets account for.
 *  - event window: a block or time range from docs/events.json (storms, AGENT.EXE…). Activity inside any window
 *    is "event", outside every window is "organic".
 */

export const DEFINITIONS = {
  day: 'UTC calendar day',
  week: '7 UTC days starting on Monday, labelled by that Monday',
  activeWallet: 'a wallet that sent at least one successful paint in the period',
  cohort: 'wallets whose first paint in the data fell on the same UTC day',
  retention:
    'Dn: share of a cohort that painted again exactly n days after its first day; cohorts whose day n is not over yet are left out',
  concentration:
    'share of all paints (or pixels) sent by the busiest wallets; walletsForHalf is how few wallets made 50%',
  gini: '0 = every wallet painted the same amount, 1 = one wallet did everything',
  event: 'activity inside a window from docs/events.json; organic = outside every window',
  newWallet: 'a wallet whose first paint since the first season started falls in the period',
}

const DAY = 86_400

export const dayOf = (time) => new Date(Number(time) * 1_000).toISOString().slice(0, 10)

/** The Monday (UTC) that starts the week holding this day. */
export function weekOf(day) {
  const date = new Date(`${day}T00:00:00Z`)
  const offset = (date.getUTCDay() + 6) % 7
  return new Date(date.getTime() - offset * DAY * 1_000).toISOString().slice(0, 10)
}

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY * 1_000).toISOString().slice(0, 10)

/** records: [{ owner, time (unix seconds), pixels }] → distinct wallets per day and per week. */
export function activeWallets(records) {
  const days = new Map()
  const weeks = new Map()
  for (const { owner, time } of records) {
    const day = dayOf(time)
    const week = weekOf(day)
    if (!days.has(day)) days.set(day, new Set())
    if (!weeks.has(week)) weeks.set(week, new Set())
    days.get(day).add(owner)
    weeks.get(week).add(owner)
  }
  const rows = (map, key) =>
    [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, set]) => ({ [key]: k, wallets: set.size }))
  return { daily: rows(days, 'day'), weekly: rows(weeks, 'week') }
}

/**
 * Cohort retention. `lastFullDay` is the last UTC day the data fully covers: a cohort counts for Dn only when
 * first+n ≤ lastFullDay.
 */
export function retention(records, { lastFullDay, horizons = [1, 7, 14] } = {}) {
  const daysByOwner = new Map()
  for (const { owner, time } of records) {
    if (!daysByOwner.has(owner)) daysByOwner.set(owner, new Set())
    daysByOwner.get(owner).add(dayOf(time))
  }
  const cohorts = new Map()
  for (const [owner, days] of daysByOwner) {
    const first = [...days].sort()[0]
    if (!cohorts.has(first)) cohorts.set(first, [])
    cohorts.get(first).push(owner)
  }
  const rows = [...cohorts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, owners]) => {
      const row = { day, wallets: owners.length }
      for (const n of horizons) {
        const target = addDays(day, n)
        row[`d${n}`] = lastFullDay && target <= lastFullDay
          ? owners.filter((owner) => daysByOwner.get(owner).has(target)).length
          : null
      }
      return row
    })
  const overall = {}
  for (const n of horizons) {
    const eligible = rows.filter((row) => row[`d${n}`] != null)
    const wallets = eligible.reduce((sum, row) => sum + row.wallets, 0)
    const retained = eligible.reduce((sum, row) => sum + row[`d${n}`], 0)
    overall[`d${n}`] = { eligible: wallets, retained, rate: wallets ? round(retained / wallets) : null }
  }
  return { overall, cohorts: rows }
}

const round = (value, places = 4) => Math.round(value * 10 ** places) / 10 ** places

/** How concentrated `key` (paints or pixels) is across wallets. */
export function concentration(records, key = 'paints') {
  const totals = new Map()
  for (const record of records) {
    const amount = key === 'paints' ? 1 : Number(record.pixels) || 0
    totals.set(record.owner, (totals.get(record.owner) ?? 0) + amount)
  }
  const values = [...totals.values()].sort((a, b) => b - a)
  const total = values.reduce((sum, value) => sum + value, 0)
  if (!total) return { wallets: values.length, total: 0 }
  const share = (count) => round(values.slice(0, count).reduce((sum, value) => sum + value, 0) / total)
  let running = 0
  let walletsForHalf = 0
  for (const value of values) {
    running += value
    walletsForHalf += 1
    if (running * 2 >= total) break
  }
  // Gini from the sorted values (ascending form of the standard formula).
  const ascending = [...values].reverse()
  const weighted = ascending.reduce((sum, value, i) => sum + (i + 1) * value, 0)
  const n = ascending.length
  const gini = n > 1 ? round((2 * weighted) / (n * total) - (n + 1) / n) : 0
  return {
    wallets: n,
    total,
    top1: share(1),
    top5: share(5),
    top10: share(10),
    top10Percent: share(Math.max(1, Math.ceil(n * 0.1))),
    walletsForHalf,
    gini,
  }
}

/** Is this record inside the event window? Windows give blocks ({startBlock,endBlock}) or times ({start,end}). */
export function inWindow(record, window) {
  if (window.startBlock != null)
    return BigInt(record.block) >= BigInt(window.startBlock) && BigInt(record.block) <= BigInt(window.endBlock)
  return Number(record.time) >= Number(window.start) && Number(record.time) < Number(window.end)
}

/**
 * Per event: active wallets, paints, pixels, wallets new to r3OS in it (by `firstSeen`, the block of each
 * wallet's first paint in any season) and how many of those painted again after the window ended. Plus the
 * organic/event split of everything in `records`.
 */
export function events(records, windows, firstSeen) {
  const rows = windows.map((window) => {
    const inside = records.filter((record) => inWindow(record, window))
    const wallets = new Set(inside.map((record) => record.owner))
    const fresh = [...wallets].filter((owner) => {
      const first = firstSeen.get(owner)
      return first != null && inWindow(first, window)
    })
    const after = (record) =>
      window.endBlock != null ? BigInt(record.block) > BigInt(window.endBlock) : Number(record.time) >= Number(window.end)
    const cameBack = fresh.filter((owner) => records.some((record) => record.owner === owner && after(record))).length
    return {
      id: window.id,
      label: window.label,
      wallets: wallets.size,
      paints: inside.length,
      pixels: inside.reduce((sum, record) => sum + (Number(record.pixels) || 0), 0),
      newWallets: fresh.length,
      newWalletsWhoCameBack: cameBack,
    }
  })
  const inAny = (record) => windows.some((window) => inWindow(record, window))
  const eventRecords = records.filter(inAny)
  const organicRecords = records.filter((record) => !inAny(record))
  const organicOwners = new Set(organicRecords.map((record) => record.owner))
  const eventOnly = new Set(eventRecords.map((record) => record.owner).filter((owner) => !organicOwners.has(owner)))
  return {
    windows: rows,
    split: {
      eventPaints: eventRecords.length,
      organicPaints: organicRecords.length,
      eventPixels: eventRecords.reduce((sum, record) => sum + (Number(record.pixels) || 0), 0),
      organicPixels: organicRecords.reduce((sum, record) => sum + (Number(record.pixels) || 0), 0),
      eventOnlyWallets: eventOnly.size,
      organicWallets: organicOwners.size,
    },
  }
}

/** The last UTC day fully inside the data: the day before `toTime`'s day, unless toTime ends that day exactly. */
export function lastFullDay(toTime) {
  const day = dayOf(toTime)
  return Number(toTime) % DAY === DAY - 1 ? day : addDays(day, -1)
}

/**
 * Everything at once for one group of wallets (humans or agents). `all` holds every paint record of the
 * group in all seasons up to the end of the coverage, for first-seen and cross-season numbers.
 */
export function engagement({ records, all = records, windows = [], coverage, season }) {
  const firstSeen = new Map()
  const seasonsByOwner = new Map()
  for (const record of all) {
    const known = firstSeen.get(record.owner)
    if (!known || BigInt(record.block) < BigInt(known.block)) firstSeen.set(record.owner, record)
    if (!seasonsByOwner.has(record.owner)) seasonsByOwner.set(record.owner, new Set())
    seasonsByOwner.get(record.owner).add(record.season)
  }
  const owners = new Set(records.map((record) => record.owner))
  const earlier = season != null ? [...owners].filter((owner) => [...seasonsByOwner.get(owner)].some((s) => s < season)) : []
  return {
    coverage,
    active: activeWallets(records),
    retention: retention(records, { lastFullDay: lastFullDay(coverage.toTime) }),
    concentration: { paints: concentration(records, 'paints'), pixels: concentration(records, 'pixels') },
    events: events(records, windows, firstSeen),
    ...(season != null
      ? { seasons: { wallets: owners.size, paintedInEarlierSeason: earlier.length, newThisSeason: owners.size - earlier.length } }
      : {}),
  }
}
