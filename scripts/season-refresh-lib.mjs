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
 * storm tickets, so builder, guest and anon wallets never show up in either.
 *   { "exclude": ["0xBuilder…"], "excludeFiles": ["~/Desktop/files/anon-wallets.json"] }
 */
export function parseConfig(text, home) {
  const raw = JSON.parse(text)
  const exclude = Array.isArray(raw.exclude) ? raw.exclude.map(String) : []
  const excludeFiles = Array.isArray(raw.excludeFiles)
    ? raw.excludeFiles.map((p) => expandHome(String(p), home))
    : []
  for (const value of exclude)
    if (!ADDRESS.test(value))
      throw new Error('season-refresh.local.json: an "exclude" entry is not an address')
  return { exclude, excludeFiles }
}

/** The steps, in order. `rpc` is passed on but never printed (the label never contains it). */
export function plan({ storms, exclude, excludeFiles, rpc, statsOut = 'docs/season-stats.json' }) {
  const rpcArgs = rpc ? ['--rpc', rpc] : []
  const excludeArgs = [
    ...(exclude.length ? ['--exclude', exclude.join(',')] : []),
    ...excludeFiles.flatMap((file) => ['--exclude-file', file]),
  ]
  const steps = [
    { label: 'Season Replay (public/replay)', script: 'scripts/export-replay.mjs', args: [...rpcArgs] },
    {
      label: 'Live Mode sessions (public/live/sessions.json)',
      script: 'scripts/export-sessions.mjs',
      args: [...rpcArgs],
    },
    {
      label: `season stats (${statsOut}, public/season/painters.json)`,
      script: 'scripts/community-stats.mjs',
      args: [
        '--range',
        '100',
        '--concurrency',
        '8',
        '--json',
        '--painters-out',
        'public/season/painters.json',
        ...excludeArgs,
        ...rpcArgs,
      ],
      stdoutTo: statsOut,
    },
    {
      label: 'season chart (docs/media/season-days.svg)',
      script: 'scripts/season-chart.mjs',
      args: ['--in', statsOut],
    },
  ]
  if (storms.length)
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

/** Files the refresh can change, for the `git add` it prints at the end. */
export const REFRESHED_FILES = [
  'public/replay',
  'public/live/sessions.json',
  'docs/season-stats.json',
  'public/season/painters.json',
  'docs/media/season-days.svg',
  'public/storms/season-1.json',
]
