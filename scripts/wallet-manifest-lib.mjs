/**
 * docs/wallets.json: the public list of wallets the community numbers treat differently, by category, addresses
 * only. With it anyone can rebuild every published number from the chain without a private config file.
 *
 * {
 *   "version": 1,
 *   "groups": [
 *     { "id": "builder", "label": "…", "treatment": "excluded", "description": "…",
 *       "wallets": [{ "address": "0x…", "name": "optional", "note": "optional" }] },
 *     { "id": "agents",  "label": "…", "treatment": "agents", … }
 *   ]
 * }
 * treatment "excluded": left out of every community number. "agents": counted, and also shown apart from humans.
 */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const TREATMENTS = new Set(['excluded', 'agents'])

export function parseManifest(text) {
  const raw = JSON.parse(text)
  if (raw.version !== 1 || !Array.isArray(raw.groups)) throw new Error('wallets manifest: expected version 1 with groups[]')
  const seen = new Map()
  const groups = raw.groups.map((group) => {
    if (!group.id || !TREATMENTS.has(group.treatment))
      throw new Error(`wallets manifest: group "${group.id}" needs an id and a treatment (excluded or agents)`)
    const wallets = (group.wallets ?? []).map((wallet) => {
      if (!ADDRESS.test(String(wallet.address)))
        throw new Error(`wallets manifest: "${group.id}" has an entry that is not an address`)
      const address = wallet.address.toLowerCase()
      if (seen.has(address))
        throw new Error(`wallets manifest: ${address} is listed twice ("${seen.get(address)}" and "${group.id}")`)
      seen.set(address, group.id)
      return { ...wallet, address }
    })
    return { ...group, wallets }
  })
  const pick = (treatment) => groups.filter((g) => g.treatment === treatment).flatMap((g) => g.wallets.map((w) => w.address))
  return { groups, exclude: pick('excluded'), agents: pick('agents') }
}

/** Counts per group, for the published numbers ("not counting 7 builder wallets, 33 anons…"). */
export function manifestSummary(manifest) {
  return manifest.groups.map((group) => ({
    id: group.id,
    label: group.label,
    treatment: group.treatment,
    wallets: group.wallets.length,
  }))
}

/** docs/events.json: named block or time windows (storms, AGENT.EXE…). */
export function parseEvents(text) {
  const raw = JSON.parse(text)
  if (raw.version !== 1 || !Array.isArray(raw.events)) throw new Error('events: expected version 1 with events[]')
  return raw.events.map((event) => {
    const byBlock = event.startBlock != null && event.endBlock != null
    const byTime = event.start != null && event.end != null
    if (!event.id || byBlock === byTime)
      throw new Error(`events: "${event.id}" needs an id and either startBlock/endBlock or start/end`)
    return event
  })
}
