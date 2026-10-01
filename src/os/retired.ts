/**
 * Programs retired from the r3tardOS interface (2026-10-01 product decision). Their contracts stay deployed and
 * untouched; the app just never opens them, lists them, links to them or counts them. Pure data, no React, so
 * Run…, the program registry, Quests, My Pass and the Operator view all share one list.
 */

/** Program ids (src/os/programs.ts) that can no longer be opened by any route. */
export const RETIRED_PROGRAMS: ReadonlySet<string> = new Set([
  'flipbook',
  'weeds',
  'forks',
  'brushes',
  'sleepwalker',
  'lanes',
  'defrag',
  'page-exe',
  'card-mem',
  'kernel-debugger',
  'router',
])

/**
 * Paint experiment-registry names whose only interface was a retired program. Quests and Pass stamps that read
 * from these contracts are hidden. `card-drv` is deliberately NOT here: its MONAD CARD stamp and the CARD CARRIER
 * quest are earned by holding a Monad Card, and Block Camera still reads the card.
 */
export const RETIRED_EXPERIMENTS: ReadonlySet<string> = new Set([
  'flipbook',
  'weeds',
  'forks',
  'brushes',
  'sleepwalker',
  'page-exe',
  'kernel-debugger',
  'router-lab',
  'router-mock-venues',
])

/**
 * Operator Record v1 subsystem ids that are only reachable through retired programs: FLIPBOOK 4, WEEDS 5,
 * FORKS 6, BLOCK DNA 7, SLEEPWALKER 9, KERNEL DEBUGGER 12, PAGE.EXE 13, CARD.DRV 14 (a formatted card page
 * needs CARDMEM.EXE). The onchain record is unchanged; the app only stops showing and counting them.
 */
export const RETIRED_SUBSYSTEMS: ReadonlySet<number> = new Set([4, 5, 6, 7, 9, 12, 13, 14])

export const isRetiredProgram = (id: string) => RETIRED_PROGRAMS.has(id)

/** Lower-cased addresses of retired experiments, from the registry's `name → address` map. */
export function retiredAddresses(labs: Readonly<Record<string, string | undefined>>): Set<string> {
  const out = new Set<string>()
  for (const name of RETIRED_EXPERIMENTS) {
    const address = labs[name]
    if (address) out.add(address.toLowerCase())
  }
  return out
}

/** A quest is retired when any of its conditions reads a retired experiment. */
export function questIsRetired(conditions: readonly { target: string }[], retired: ReadonlySet<string>) {
  return conditions.some((condition) => retired.has(condition.target.toLowerCase()))
}
