export const ROUTER_COPY = {
  lead: 'watch Monad compare executable liquidity inside one execution.',
  monad:
    'each venue is quoted in its own child frame that is always rolled back; one eth_call, one block state.',
  rules: [
    'nothing is persistently swapped, approved or sent; RUN is an eth_call preview and QUOTE SCOPE unwinds its internal simulation.',
    'MRC-17 is a draft interface and every configured adapter is treated as untrusted.',
    'adapter failures are isolated and reported separately; selection means highest quoted output only.',
  ],
  draft: 'MRC-17 DRAFT',
  thirdParty: 'third-party adapters · unaudited integration code',
  highest: 'HIGHEST QUOTED OUTPUT',
  validityEmpty: 'not exposed (swapData empty)',
  validityOpaque: 'UNKNOWN (opaque swapData)',
  rolledBack: 'rolled back',
  staticNeed: 'quote path needs a non-static frame',
  scopeNote:
    'same state, same caller, inside one eth_call; the execution preview ran in a frame that was rolled back; not a guarantee for a later block.',
  statusPreview: 'selection inside EVM execution (preview, nothing executed)',
  noDriver: 'driver not installed',
  noVenues: 'no venues configured for this chain',
  mock: 'MOCK VENUES',
  pinUnavailable: 'block pin unavailable',
} as const

export const FORWARDING_COPY = {
  title: 'Transaction forwarding',
  globalLabel: 'Global mempool',
  globalValue: 'none; each validator keeps a local mempool',
  forwardingLabel: 'Forwarding',
  forwardingValue: 'RPC node → next 3 leaders, retried with later leaders',
  seenLabel: 'Seen before inclusion by',
  seenValue: 'the RPC operator and upcoming leaders',
  measuredLabel: 'Measured sandwiching',
  measuredValue: 'no persistent sandwich bots on Monad, 24 Nov 2025 – 30 Jun 2026, largest AMMs',
  sources:
    'sources: Monad local-mempool / transaction-lifecycle docs · Heimbach, Solmaz, Öz & Ferreira Torres, arXiv:2609.28115v1 (2026); Category Labs is a co-author affiliation.',
  footnote:
    "the same study measured 28.0M sandwiches on Solana, whose forwarding design Monad's mirrors; counts describe attacker behaviour, not a guarantee.",
} as const
