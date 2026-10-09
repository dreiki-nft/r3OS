/** Pure, offline checks for the Season Replay file the judge path actually loads. */
export function inspectSubmissionReplay(replay, season = 0) {
  const errors = []
  if (!replay || typeof replay !== 'object' || Array.isArray(replay)) return ['replay is not an object']
  if (replay.version !== 1) errors.push('expected replay schema version 1')
  if (replay.chainId !== 143) errors.push('expected Monad mainnet chainId 143')
  if (replay.season !== season) errors.push(`season index must be ${season}`)
  if (String(replay.paint).toLowerCase() !== '0x5102de3817ae16b3afaeb9d180130669a70787b3')
    errors.push('unexpected Paint contract')
  const block = (value) => (/^\d+$/.test(String(value)) ? BigInt(value) : undefined)
  const from = block(replay.fromBlock)
  const to = block(replay.toBlock)
  if (from == null || to == null || from > to) errors.push('invalid block range')
  if (!Array.isArray(replay.painters) || replay.painters.length === 0) errors.push('no painter list')
  if (!Array.isArray(replay.events) || replay.events.length === 0) errors.push('no paint events')
  return errors
}
