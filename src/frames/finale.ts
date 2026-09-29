import type { Address } from 'viem'

export const FINALE_HOLDER_WINDOW = 7n * 24n * 60n * 60n

function same(a?: Address, b?: Address) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase())
}

export function finaleEligibility({
  endsAt,
  successfulPaints,
  finaleMinted,
  now,
  account,
  tokenZeroOwner,
  approved,
  operatorApproved,
}: {
  endsAt: bigint
  successfulPaints: bigint
  finaleMinted: boolean
  now: bigint
  account?: Address
  tokenZeroOwner: Address
  approved?: Address
  operatorApproved: boolean
}) {
  const ready = now >= endsAt && successfulPaints > 0n && !finaleMinted
  const holderWindowEnds = endsAt + FINALE_HOLDER_WINDOW
  const authorized = Boolean(
    account && (same(account, tokenZeroOwner) || same(account, approved) || operatorApproved),
  )
  const publicOpen = now >= holderWindowEnds
  return {
    ready,
    authorized,
    publicOpen,
    canMint: ready && Boolean(account) && (authorized || publicOpen),
    holderWindowEnds,
  }
}
