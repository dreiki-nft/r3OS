/**
 * Fair-play review signals from public paint data (a season replay file: every Painted event in order).
 * Pure functions. They FLAG wallets for a human to look at; none of them is a verdict, and high activity alone
 * is never a flag. The review process and the rules are in docs/FAIR_PLAY.md.
 *
 * Signals:
 *  - rhythm:   bot-like timing: very regular gaps between paints, or painting around the clock for days.
 *  - farming:  paints that mostly repaint the wallet's own still-wet pixels (cheap in budget and heat, so a way
 *              to inflate paint counts without changing the canvas).
 *  - pairs:    two wallets that look like one person: they never paint at the same time but keep handing over
 *              to each other within minutes, and (optionally) caught the same storms.
 *  - minimal:  wallets whose whole history is a few tiny paints inside event windows (the cheapest way to farm
 *              per-wallet rewards such as storm tickets).
 */

export const WET_WINDOW_BLOCKS = 2_000 // R3OSPaint.WET_WINDOW_BLOCKS
const WIDTH = 256

/** A replay event's runs (4 bytes each: row, x0, x1, colour) → pixel indexes. */
export function runPixels(runsHex) {
  const bytes = Buffer.from(String(runsHex).slice(2), 'hex')
  const out = []
  for (let o = 0; o + 3 < bytes.length; o += 4) {
    const [y, x0, x1] = [bytes[o], bytes[o + 1], bytes[o + 2]]
    for (let x = x0; x <= x1; x++) out.push(y * WIDTH + x)
  }
  return out
}

/** A replay file → records { owner, block, time, pixels[] } in chain order, time interpolated from the file's range. */
export function replayRecords(replay, { exclude = [] } = {}) {
  const skip = new Set(exclude.map((a) => a.toLowerCase()))
  const from = Number(replay.fromBlock)
  const span = Math.max(1, Number(replay.toBlock) - from)
  const seconds = Number(replay.toTime) - Number(replay.fromTime)
  return replay.events
    .map(([offset, painter, runs]) => ({
      owner: replay.painters[painter].toLowerCase(),
      block: from + offset,
      time: Math.round(Number(replay.fromTime) + (offset / span) * seconds),
      pixels: runPixels(runs),
    }))
    .filter((record) => !skip.has(record.owner))
}

const byOwner = (records) => {
  const map = new Map()
  for (const record of records) {
    if (!map.has(record.owner)) map.set(record.owner, [])
    map.get(record.owner).push(record)
  }
  return map
}

/** Painting sessions: runs of paints with gaps under `gap` seconds. */
export function sessions(times, gap = 600) {
  const out = []
  for (const time of [...times].sort((a, b) => a - b)) {
    const last = out.at(-1)
    if (last && time - last.end <= gap) {
      last.end = time
      last.paints += 1
    } else out.push({ start: time, end: time, paints: 1 })
  }
  return out
}

/** Timing signals for one wallet. */
export function rhythm(times) {
  const sorted = [...times].sort((a, b) => a - b)
  const gaps = sorted
    .slice(1)
    .map((t, i) => t - sorted[i])
    .filter((g) => g > 0 && g < 600)
  const mean = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0
  const sd = gaps.length ? Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length) : 0
  const hoursByDay = new Map()
  for (const t of sorted) {
    const day = Math.floor(t / 86_400)
    if (!hoursByDay.has(day)) hoursByDay.set(day, new Set())
    hoursByDay.get(day).add(Math.floor((t % 86_400) / 3_600))
  }
  const list = sessions(sorted)
  return {
    paints: sorted.length,
    gapCv: gaps.length >= 50 ? Math.round((sd / mean) * 100) / 100 : null,
    maxHoursInADay: Math.max(0, ...[...hoursByDay.values()].map((h) => h.size)),
    daysWith20PlusHours: [...hoursByDay.values()].filter((h) => h.size >= 20).length,
    longestSessionMinutes: Math.round(Math.max(0, ...list.map((s) => s.end - s.start)) / 60),
    sessions: list.length,
  }
}

/**
 * Self-repaint share: of a wallet's painted pixels, how many repainted a pixel that the same wallet had painted
 * within the wet window (cost 1 budget unit and no heat).
 */
export function farming(records) {
  const last = new Map() // pixel → { owner, block }
  const stats = new Map()
  for (const record of records) {
    const row = stats.get(record.owner) ?? { pixels: 0, selfWet: 0, distinct: new Set() }
    for (const pixel of record.pixels) {
      const before = last.get(pixel)
      if (before && before.owner === record.owner && record.block - before.block <= WET_WINDOW_BLOCKS)
        row.selfWet += 1
      row.pixels += 1
      row.distinct.add(pixel)
      last.set(pixel, { owner: record.owner, block: record.block })
    }
    stats.set(record.owner, row)
  }
  return new Map(
    [...stats].map(([owner, row]) => [
      owner,
      {
        pixels: row.pixels,
        distinctPixels: row.distinct.size,
        selfWetShare: row.pixels ? Math.round((row.selfWet / row.pixels) * 1_000) / 1_000 : 0,
      },
    ]),
  )
}

/**
 * Pair signal for two wallets: minutes both were active, handovers (one stops, the other starts within
 * `handover` seconds) and the share of their sessions that are part of a handover.
 */
export function pairSignal(timesA, timesB, { handover = 600 } = {}) {
  const a = sessions(timesA)
  const b = sessions(timesB)
  const minutes = (list) => {
    const set = new Set()
    for (const s of list) for (let m = Math.floor(s.start / 60); m <= Math.floor(s.end / 60); m++) set.add(m)
    return set
  }
  const ma = minutes(a)
  const mb = minutes(b)
  const overlap = [...ma].filter((m) => mb.has(m)).length
  const all = [...a.map((s) => ({ ...s, w: 'a' })), ...b.map((s) => ({ ...s, w: 'b' }))].sort(
    (x, y) => x.start - y.start,
  )
  let handovers = 0
  for (let i = 1; i < all.length; i++)
    if (
      all[i].w !== all[i - 1].w &&
      all[i].start - all[i - 1].end >= 0 &&
      all[i].start - all[i - 1].end <= handover
    )
      handovers += 1
  return { overlapMinutes: overlap, handovers, sessions: a.length + b.length }
}

const jaccard = (a, b) => {
  if (!a?.size || !b?.size) return null
  const inter = [...a].filter((x) => b.has(x)).length
  return Math.round((inter / (a.size + b.size - inter)) * 100) / 100
}

export const THRESHOLDS = {
  rhythmMinPaints: 300, // timing is only judged with enough paints
  regularGapCv: 0.25, // gaps this regular are machine-like (people are bursty: CV well above 1)
  aroundTheClockDays: 2, // painting in 20+ distinct hours of a day, on this many days
  farmingMinPixels: 2_000,
  farmingSelfWetShare: 0.6,
  pairMinSessions: 10,
  pairMinHandovers: 5,
  pairMaxOverlapMinutes: 0,
  minimalMaxPaints: 3,
}

/**
 * Every signal for every wallet, and the flags they raise. `storms` (optional): Map owner → Set of storm
 * numbers caught, to strengthen pair signals. `eventOnly` (optional): Set of wallets whose paints all fall
 * inside event windows.
 */
export function review(records, { storms, eventOnly, thresholds = THRESHOLDS } = {}) {
  const owners = byOwner(records)
  const farm = farming(records)
  const flags = []
  const wallets = []
  const times = new Map([...owners].map(([owner, list]) => [owner, list.map((r) => r.time)]))
  for (const [owner, list] of owners) {
    const r = rhythm(times.get(owner))
    const f = farm.get(owner)
    wallets.push({ owner, ...r, ...f })
    if (r.paints >= thresholds.rhythmMinPaints && r.gapCv != null && r.gapCv < thresholds.regularGapCv)
      flags.push({
        kind: 'rhythm',
        wallets: [owner],
        evidence: `gaps between paints are machine-regular (CV ${r.gapCv})`,
      })
    if (r.daysWith20PlusHours >= thresholds.aroundTheClockDays)
      flags.push({
        kind: 'rhythm',
        wallets: [owner],
        evidence: `painted in 20+ different hours on ${r.daysWith20PlusHours} days`,
      })
    if (f.pixels >= thresholds.farmingMinPixels && f.selfWetShare >= thresholds.farmingSelfWetShare)
      flags.push({
        kind: 'farming',
        wallets: [owner],
        evidence: `${Math.round(f.selfWetShare * 100)}% of its pixels repaint its own wet pixels`,
      })
    if (eventOnly?.has(owner) && list.length <= thresholds.minimalMaxPaints)
      flags.push({
        kind: 'minimal',
        wallets: [owner],
        evidence: `${list.length} paint(s), all inside event windows`,
      })
  }
  const active = [...owners.keys()].filter((o) => sessions(times.get(o)).length >= thresholds.pairMinSessions)
  for (let i = 0; i < active.length; i++)
    for (let j = i + 1; j < active.length; j++) {
      const p = pairSignal(times.get(active[i]), times.get(active[j]))
      if (
        p.overlapMinutes <= thresholds.pairMaxOverlapMinutes &&
        p.handovers >= thresholds.pairMinHandovers
      ) {
        const same = storms ? jaccard(storms.get(active[i]), storms.get(active[j])) : null
        flags.push({
          kind: 'pair',
          wallets: [active[i], active[j]],
          evidence: `never painted at the same time, ${p.handovers} handovers within 10 minutes${same != null ? `, storm overlap ${same}` : ''}`,
        })
      }
    }
  return { wallets, flags }
}
