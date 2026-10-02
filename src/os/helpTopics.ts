/**
 * Help topic ids shared by the Help window and every "How it works" / "Help Topics" link. Pure data so any
 * program can link straight to its own page without importing the Help component.
 */
export const HELP_TOPICS = [
  { slug: 'welcome', title: 'welcome', group: 'start' },
  { slug: 'getting-started', title: 'getting started', group: 'start' },
  { slug: 'paint', title: 'Paint', group: 'programs', program: 'paint' },
  { slug: 'frames', title: 'My Frames', group: 'programs', program: 'frames' },
  { slug: 'pass', title: 'My Pass', group: 'programs', program: 'pass' },
  { slug: 'cd', title: 'Burn a CD', group: 'programs', program: 'cd' },
  { slug: 'cdrom', title: 'CD-ROM (D:)', group: 'programs', program: 'cdrom' },
  { slug: 'auction', title: 'Auction', group: 'programs', program: 'auction' },
  { slug: 'quests', title: 'Quests', group: 'programs', program: 'quests' },
  { slug: 'bin', title: 'Recycle Bin', group: 'programs', program: 'bin' },
  { slug: 'validators', title: 'Validators', group: 'programs', program: 'validators' },
  { slug: 'block-camera', title: 'Block Camera', group: 'monad', program: 'block-camera' },
  { slug: 'monad-hw', title: 'Monad Hardware', group: 'monad', program: 'monad-hw' },
  { slug: 'xray', title: 'Monad X-ray', group: 'monad', program: 'xray' },
  { slug: 'dxdiag', title: 'DXDIAG.EXE', group: 'monad', program: 'dxdiag' },
  { slug: 'seasons', title: 'seasons & finales', group: 'basics' },
  { slug: 'storms', title: 'storms & glitches', group: 'basics' },
  { slug: 'live-mode', title: 'live mode', group: 'basics' },
  { slug: 'gas', title: 'gas on Monad', group: 'basics' },
  { slug: 'sounds', title: 'Sounds', group: 'basics', program: 'sounds' },
  { slug: 'run', title: 'Run…', group: 'basics', program: 'run' },
  { slug: 'owner-powers', title: 'owner powers', group: 'basics' },
  { slug: 'system-log', title: 'system.log', group: 'basics' },
  { slug: 'credits', title: 'credits', group: 'basics' },
] as const

export type HelpSlug = (typeof HELP_TOPICS)[number]['slug']

export const HELP_GROUPS: Record<(typeof HELP_TOPICS)[number]['group'], string> = {
  start: 'start here',
  programs: 'programs',
  monad: 'Monad',
  basics: 'how it works',
}

export const isHelpSlug = (value: unknown): value is HelpSlug =>
  typeof value === 'string' && HELP_TOPICS.some((topic) => topic.slug === value)

export const helpHash = (slug: HelpSlug) => `#/help?topic=${slug}`

/** Reads `?topic=` from a `#/help?topic=…` hash; anything unknown falls back to the welcome page. */
export function helpSlugFromHash(hash: string): HelpSlug {
  const query = hash.split('?')[1] ?? ''
  const topic = new URLSearchParams(query).get('topic')
  return isHelpSlug(topic) ? topic : 'welcome'
}
