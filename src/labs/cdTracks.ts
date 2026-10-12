/**
 * Which selected CD tracks are no longer this wallet's. A track's token can have moved to another wallet,
 * or be gone entirely (a frame thrown in the Recycle Bin). ownerOf reverts for a gone token, and that is an
 * answer, not a failure: the track is stale and its owner is nobody. Any other failed read (network, RPC)
 * is a real failure and is reported as one.
 */
export interface OwnerRow {
  status: 'success' | 'failure'
  result?: unknown
  error?: Error
}

export interface StaleTracks<K> {
  /** keys of tracks that are not owned by the account any more */
  stale: K[]
  /** the owner each stale track has now (null when the token no longer exists) */
  owners: Map<K, string | null>
  /** a read that failed for a reason other than "this token doesn't exist" */
  failure?: Error
}

export function staleTracks<K>(
  account: string,
  keys: readonly K[],
  rows: readonly OwnerRow[],
  isMissingToken: (error: unknown) => boolean,
): StaleTracks<K> {
  const me = account.toLowerCase()
  const stale: K[] = []
  const owners = new Map<K, string | null>()
  for (let i = 0; i < keys.length; i++) {
    const row = rows[i]
    if (!row || row.status !== 'success') {
      if (row && isMissingToken(row.error)) {
        stale.push(keys[i])
        owners.set(keys[i], null)
        continue
      }
      return { stale: [], owners: new Map(), failure: row?.error ?? new Error('CD_OWNERSHIP_UNAVAILABLE') }
    }
    const owner = String(row.result).toLowerCase()
    if (owner !== me) {
      stale.push(keys[i])
      owners.set(keys[i], owner)
    }
  }
  return { stale, owners }
}
