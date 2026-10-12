import { describe, expect, it } from 'vitest'
import { staleTracks } from './cdTracks'

const ME = '0x00000000000000000000000000000000000000Aa'
const OTHER = '0x00000000000000000000000000000000000000bb'
const missing = Object.assign(new Error('ERC721NonexistentToken(13)'), { missing: true })
const network = new Error('fetch failed')
const isMissing = (error: unknown) => Boolean((error as { missing?: boolean })?.missing)

describe('stale CD tracks', () => {
  it('keeps owned tracks, and marks moved and recycled ones stale with their new owner', () => {
    const result = staleTracks(
      ME,
      ['frame:12', 'frame:13', 'frame:14'],
      [
        { status: 'success', result: ME.toLowerCase() },
        { status: 'failure', error: missing },
        { status: 'success', result: OTHER },
      ],
      isMissing,
    )
    expect(result.failure).toBeUndefined()
    expect(result.stale).toEqual(['frame:13', 'frame:14'])
    expect(result.owners.get('frame:13')).toBeNull()
    expect(result.owners.get('frame:14')).toBe(OTHER)
  })

  it('reports a failed read that is not a missing token instead of guessing', () => {
    const result = staleTracks(ME, ['frame:12', 'frame:13'], [
      { status: 'success', result: ME },
      { status: 'failure', error: network },
    ], isMissing)
    expect(result.failure).toBe(network)
    expect(result.stale).toEqual([])
  })
})
