/**
 * Compatibility filters for the historical snapshot-28 testnet deployment.
 *
 * Phase 7.6 removes discontinued experiments from the fresh-mainnet source/deployment surface, but the existing
 * testnet registry and Operator Record v1 can still expose their historical ids and addresses. Keep those records
 * intact and hide them at the product boundary rather than pretending the old chain state disappeared.
 */

/** Program ids that can no longer be opened by any current r3OS route. */
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
 * Historical Paint registry names that should not leak back into current Quests/Pass discovery when r3OS is
 * connected to snapshot-28 testnet state. Active backends such as `card-drv` are deliberately not included.
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
 * Fixed Operator Record v1 ids that are hidden from the current product surface. The v1 ids are historical
 * protocol slots and are never repurposed; fresh mainnet passes zero source addresses for discontinued slots.
 * PAGE.EXE/CARD.DRV also remain hidden as standalone programs even though their active backends are used elsewhere.
 */
export const RETIRED_SUBSYSTEMS: ReadonlySet<number> = new Set([4, 5, 6, 7, 9, 12, 13, 14])

export const isRetiredProgram = (id: string) => RETIRED_PROGRAMS.has(id)

/** Lower-cased addresses of historical experiments, from the registry's `name → address` map. */
export function retiredAddresses(labs: Readonly<Record<string, string | undefined>>): Set<string> {
  const out = new Set<string>()
  for (const name of RETIRED_EXPERIMENTS) {
    const address = labs[name]
    if (address) out.add(address.toLowerCase())
  }
  return out
}

/** A quest is historical when any of its conditions reads a historical experiment. */
export function questIsRetired(conditions: readonly { target: string }[], retired: ReadonlySet<string>) {
  return conditions.some((condition) => retired.has(condition.target.toLowerCase()))
}
