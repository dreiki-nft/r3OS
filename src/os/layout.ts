/**
 * Where each visible program lives in the shell. The desktop is prime real estate: only the things that define
 * r3tardOS sit there. Everything else stays one menu away (Start › Programs, Start › System Tools, Run…) or is
 * opened from inside the program it belongs to (Burn a CD from My Frames). Pure data so the layout is tested.
 */

/** Desktop icons, in order. Auction joins them only while an auction is running (see `desktopProgramIds`). */
export const DESKTOP_PROGRAMS = [
  'paint',
  'monad-hw',
  'frames',
  'pass',
  'block-camera',
  'cdrom',
  'quests',
  'bin',
] as const

/** Start › Programs: everything a person uses, desktop or not. */
export const START_PROGRAMS = [
  'paint',
  'frames',
  'pass',
  'block-camera',
  'cdrom',
  'quests',
  'cd',
  'auction',
  'bin',
] as const

/** Start › System Tools: support, diagnostics and settings. */
export const SYSTEM_TOOLS = ['xray', 'validators', 'dxdiag', 'sounds'] as const

/** Opened from Start's top level directly (no submenu). */
export const EXPLORE_PROGRAM = 'monad-hw'

/** Desktop ids to show, given which programs are visible and whether an auction is live right now. */
export function desktopProgramIds(isVisible: (id: string) => boolean, auctionLive: boolean): string[] {
  const ids: string[] = DESKTOP_PROGRAMS.filter(isVisible)
  if (auctionLive && isVisible('auction')) ids.push('auction')
  return ids
}

/** Start menu groups, filtered to visible programs. */
export function startMenuGroups(isVisible: (id: string) => boolean) {
  return {
    programs: START_PROGRAMS.filter(isVisible) as string[],
    explore: isVisible(EXPLORE_PROGRAM) ? EXPLORE_PROGRAM : undefined,
    tools: SYSTEM_TOOLS.filter(isVisible) as string[],
    help: isVisible('help'),
  }
}
