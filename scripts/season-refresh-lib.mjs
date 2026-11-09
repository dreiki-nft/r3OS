// Pure helpers for scripts/season-refresh.mjs (unit-tested; no network, no child processes here).
import { homedir } from 'node:os'

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const STORM_PERIOD = 200_000n
const STORM_LENGTH = 600n
export const SEASON_FIRST_STORM = 115_400_000n
export const SEASON_STORMS = 21

/** Season storms (start blocks) that have fully ended by `head`: the ones storm-chasers can count. */
export function finishedStorms(head) {
  const out = []
  for (let i = 0n; i < BigInt(SEASON_STORMS); i++) {
    const start = SEASON_FIRST_STORM + i * STORM_PERIOD
    if (start + STORM_LENGTH - 1n <= head) out.push(start)
  }
  return out
}

/** `~/Desktop/x.json` → an absolute path (Node does not expand `~` by itself). */
export function expandHome(path, home = homedir()) {
  return path === '~' || path.startsWith('~/') || path.startsWith('~\\') ? home + path.slice(1) : path
}

/**
 * season-refresh.local.json (gitignored): which wallets are not community. Same list for the stats and the
 * storm tickets, so builder, guest and anon wallets never show up in either. AI agent wallets (AGENT.EXE) are
 * counted, but on their own next to the humans:
 *   { "exclude": ["0xBuilder…"], "excludeFiles": ["~/Desktop/files/anon-wallets.json"],
 *     "agentFiles": ["~/Desktop/files/agent-wallets.json"] }
 */
export function parseConfig(text, home) {
  const raw = JSON.parse(text)
  const exclude = Array.isArray(raw.exclude) ? raw.exclude.map(String) : []
  const files = (key) => (Array.isArray(raw[key]) ? raw[key].map((p) => expandHome(String(p), home)) : [])
  for (const value of exclude)
    if (!ADDRESS.test(value))
      throw new Error('season-refresh.local.json: an "exclude" entry is not an address')
  return { exclude, excludeFiles: files('excludeFiles'), agentFiles: files('agentFiles') }
}

/** Where a season's numbers go. Season 1 keeps the names the README has always linked. */
export function seasonFiles(season) {
  if (season === 0) return { stats: 'docs/season-stats.json', chart: 'docs/media/season-days.svg' }
  return { stats: `docs/season-${season + 1}-stats.json`, chart: `docs/media/season-${season + 1}-days.svg` }
}

/**
 * The steps, in order, for `season` (the contract's index: 0 = season 1). `rpc` is passed on but never printed
 * (the label never contains it). Storm Chasers and My Season (public/season/painters.json) belong to season 1.
 */
export function plan({ season = 0, storms, exclude = [], excludeFiles = [], agentFiles = [], manifest, events, rpc }) {
  const rpcArgs = rpc ? ['--rpc', rpc] : []
  const excludeArgs = [
    ...(exclude.length ? ['--exclude', exclude.join(',')] : []),
    ...excludeFiles.flatMap((file) => ['--exclude-file', file]),
  ]
  const { stats, chart } = seasonFiles(season)
  const first = season === 0
  const steps = [
    {
      label: `Season Replay (public/replay/season-${season}.json)`,
      script: 'scripts/export-replay.mjs',
      args: ['--season', String(season), ...rpcArgs],
    },
    {
      label: 'Live Mode sessions (public/live/sessions.json)',
      script: 'scripts/export-sessions.mjs',
      args: [...rpcArgs],
    },
    {
      label: `season ${season + 1} stats (${stats}${first ? ', public/season/painters.json' : ''})`,
      script: 'scripts/community-stats.mjs',
      args: [
        '--range',
        '100',
        '--concurrency',
        '8',
        '--json',
        '--season',
        String(season),
        ...(first ? ['--painters-out', 'public/season/painters.json'] : []),
        // The public manifest first (docs/wallets.json), then any local extras.
        ...(manifest ? ['--manifest', manifest] : []),
        ...(events ? ['--events', events] : []),
        ...excludeArgs,
        ...agentFiles.flatMap((file) => ['--agents-file', file]),
        ...rpcArgs,
      ],
      stdoutTo: stats,
    },
    {
      label: `season ${season + 1} chart (${chart})`,
      script: 'scripts/season-chart.mjs',
      args: ['--in', stats, '--out', chart],
    },
  ]
  if (first && storms.length)
    steps.push({
      label: `Storm Chasers, storms 1-${storms.length} (public/storms/season-1.json)`,
      script: 'scripts/storm-chasers.mjs',
      args: [
        '--storms',
        storms.join(','),
        ...excludeArgs,
        '--public',
        'public/storms/season-1.json',
        ...rpcArgs,
      ],
    })
  return steps
}

/** Files the refresh can change in `season`, for the `git add` it prints at the end. */
export function refreshedFiles(season = 0) {
  const { stats, chart } = seasonFiles(season)
  return [
    'public/replay',
    'public/live/sessions.json',
    stats,
    chart,
    ...(season === 0 ? ['public/season/painters.json', 'public/storms/season-1.json'] : []),
  ]
}
