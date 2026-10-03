import { describe, expect, it } from 'vitest'
import type { Address } from 'viem'
import {
  applyConfirmedFrameActivityToIndex,
  seasonIndexChanged,
  applyTransferToOwnerMap,
  ownerScanBatches,
  ownersFromReadMany,
  ownersFromSettled,
  pageNewestFirst,
  seasonTotal,
  visibleFlaggedIds,
} from './framesStore'

describe('frames store helpers', () => {
  it('sums regular and finale frames across seasons', () => {
    expect(
      seasonTotal([
        { regularFrames: 2, finaleMinted: true },
        { regularFrames: 4, finaleMinted: false },
        { regularFrames: 1, finaleMinted: true },
      ]),
    ).toBe(9)
  })

  it('pages newest-first in groups of 24', () => {
    const ids = Array.from({ length: 30 }, (_, index) => index + 1)
    expect(pageNewestFirst(ids, 1)).toEqual(Array.from({ length: 24 }, (_, index) => 30 - index))
    expect(pageNewestFirst(ids, 2)).toHaveLength(30)
  })

  it('scans owners in batches of at most 100', () => {
    const batches = ownerScanBatches(1, 205)
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 5])
    expect(batches[2]).toEqual([201, 202, 203, 204, 205])
  })

  it('treats ownerOf reverts as burned', () => {
    const owner = '0x00000000000000000000000000000000000000A1' as Address
    expect(
      ownersFromSettled(
        [7, 8],
        [
          { status: 'fulfilled', value: owner },
          { status: 'rejected', reason: new Error('ERC721NonexistentToken') },
        ],
      ),
    ).toEqual({ '7': owner, '8': null })
  })

  it('maps Multicall ownerOf failures to burned tokens', () => {
    const owner = '0x00000000000000000000000000000000000000A1' as Address
    expect(
      ownersFromReadMany(
        [7, 8],
        [
          { status: 'success', result: owner },
          { status: 'failure', error: new Error('ERC721NonexistentToken') },
        ],
      ),
    ).toEqual({ '7': owner, '8': null })
  })

  it('applies Transfer ownership changes without another scan', () => {
    const owner = '0x00000000000000000000000000000000000000A1' as Address
    const next = '0x00000000000000000000000000000000000000B2' as Address
    const owners: Record<string, Address | null> = { '9': owner }
    applyTransferToOwnerMap(owners, 9n, next)
    expect(owners['9']).toBe(next)
    applyTransferToOwnerMap(owners, 9n)
    expect(owners['9']).toBeNull()
  })

  it('keeps flagged ids hidden until the viewer restores them', () => {
    expect(visibleFlaggedIds([4, 9, 12], [9])).toEqual([12, 4])
  })

  it('applies a confirmed FrameMinted event before lagging read RPCs catch up', () => {
    const previous = {
      currentSeason: 0,
      total: 0,
      seasons: [] as any[],
    }
    expect(
      applyConfirmedFrameActivityToIndex(previous, {
        eventName: 'FrameMinted',
        tokenId: 1n,
        season: 0n,
        seasonFrameIndex: 1n,
      }),
    ).toEqual({
      currentSeason: 0,
      total: 1,
      seasons: [
        {
          season: 0,
          regularFrames: 1,
          finaleMinted: false,
          finaleTokenId: 0n,
          count: 1,
        },
      ],
    })
  })

  it('does not regress a locally confirmed frame count when another mint arrives', () => {
    const previous = {
      currentSeason: 0,
      total: 4,
      seasons: [
        {
          season: 0,
          regularFrames: 4,
          finaleMinted: false,
          finaleTokenId: 0n,
          count: 4,
        },
      ],
    }
    const next = applyConfirmedFrameActivityToIndex(previous, {
      eventName: 'FrameMinted',
      tokenId: 5n,
      season: 0n,
      seasonFrameIndex: 5n,
    })
    expect(next.total).toBe(5)
    expect(next.seasons[0].regularFrames).toBe(5)
    expect(next.seasons[0].count).toBe(5)
  })
})

describe('seasonIndexChanged', () => {
  const row = { season: 0, regularFrames: 2, finaleMinted: false, finaleTokenId: 0n, count: 2 }
  const previous = { currentSeason: 1, total: 2, seasons: [row] }
  it('is false for an identical index, so refreshes do not bump the version', () => {
    expect(seasonIndexChanged(previous, 1, [{ ...row }], 2)).toBe(false)
  })
  it('is true when a finale or frame lands', () => {
    expect(seasonIndexChanged(previous, 1, [{ ...row, finaleMinted: true, finaleTokenId: 3n }], 3)).toBe(true)
    expect(seasonIndexChanged(previous, 2, [row, { ...row, season: 1, regularFrames: 0 }], 2)).toBe(true)
  })
})
