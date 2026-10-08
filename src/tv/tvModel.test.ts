import { describe, expect, it } from 'vitest'
import { bytesToHex } from 'viem'
import { PARTY_PROMPTS } from './prompts'
import { QR_ROWS, qrPath } from './qr'
import {
  boxPercent,
  dominantColour,
  flashColour,
  isTvRoute,
  mergeTvStrokes,
  painterColour,
  partyStats,
  promptIndex,
  promptProgress,
  topPainters,
  tvFrameFromActivity,
  tvStrokeFromActivity,
  type TvStroke,
} from './tvModel'

const A = '0x00000000000000000000000000000000000000aa'
const B = '0x00000000000000000000000000000000000000bb'

const stroke = (
  key: string,
  owner: string,
  block: bigint,
  pixels: number,
  extra: Partial<TvStroke> = {},
): TvStroke => ({
  key,
  owner,
  block,
  pixels,
  box: { x0: 0, y0: 0, x1: 0, y1: 0 },
  colour: 4,
  seenAt: 0,
  live: false,
  ...extra,
})

describe('broadcast view model', () => {
  it('only opens on the exact route', () => {
    expect(isTvRoute('#/tv')).toBe(true)
    expect(isTvRoute('#/tv/')).toBe(true)
    expect(isTvRoute('#/tv?msg=hello')).toBe(false)
    expect(isTvRoute('#/tvx')).toBe(false)
    expect(isTvRoute('#/paint')).toBe(false)
  })

  it('finds the colour a stroke used most and keeps flashes visible on black', () => {
    // y, x0, x1, colour: 3 px of red (4), 10 px of cyan (11)
    const runs = new Uint8Array([5, 0, 2, 4, 6, 0, 9, 11])
    expect(dominantColour(runs)).toBe(11)
    expect(dominantColour(new Uint8Array())).toBeUndefined()
    expect(flashColour(11, A)).toBe(11)
    // black, white and background would vanish on the dark screen: use the painter's colour instead
    for (const invisible of [0, 1, 7, undefined]) expect(flashColour(invisible, A)).toBe(painterColour(A))
    expect([0, 1, 7]).not.toContain(painterColour(A))
    expect(painterColour(A)).toBe(painterColour(A.toUpperCase()))
  })

  it('turns Painted and FrameMinted activity into rows', () => {
    const runs = bytesToHex(new Uint8Array([10, 20, 29, 4]))
    const row = tvStrokeFromActivity(
      {
        eventName: 'Painted',
        owner: A.toUpperCase(),
        runs,
        blockNumber: 7n,
        logIndex: 1,
        transactionHash: '0x01',
      },
      123,
    )
    expect(row).toMatchObject({
      owner: A,
      pixels: 10,
      colour: 4,
      box: { x0: 20, y0: 10, x1: 29, y1: 10 },
      live: true,
      seenAt: 123,
    })
    expect(tvStrokeFromActivity({ eventName: 'FaceChanged', blockNumber: 1n }, 0)).toBeUndefined()
    expect(
      tvFrameFromActivity(
        { eventName: 'FrameMinted', minter: B, tokenId: 9n, blockNumber: 8n, transactionHash: '0x02' },
        5,
      ),
    ).toMatchObject({ minter: B, tokenId: 9n, block: 8n })
  })

  it('never flashes the same event twice, and lets a live sighting replace a look-back row', () => {
    const lookBack = stroke('t:0', A, 5n, 3)
    const live = stroke('t:0', A, 5n, 3, { live: true, seenAt: 1_000, colour: 11 })
    const merged = mergeTvStrokes([lookBack], [live])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ live: true, seenAt: 1_000, colour: 11 })
    // the same event delivered again (proposal, then finalized) keeps its first sighting
    const again = mergeTvStrokes(merged, [stroke('t:0', A, 5n, 3, { live: true, seenAt: 9_000 })])
    expect(again[0].seenAt).toBe(1_000)
    // and a late look-back copy can't turn it back into an old row
    expect(mergeTvStrokes(again, [lookBack])[0].live).toBe(true)
    expect(
      mergeTvStrokes([stroke('a', A, 1n, 1), stroke('b', B, 3n, 1)], [stroke('c', A, 2n, 1)]).map(
        (row) => row.key,
      ),
    ).toEqual(['b', 'c', 'a'])
  })

  it('counts the party and ranks painters by pixels', () => {
    const rows = [stroke('1', A, 1n, 10), stroke('2', B, 2n, 30), stroke('3', A, 3n, 25)]
    expect(partyStats(rows, [])).toEqual({ painters: 2, pixels: 65, paints: 3, frames: 0 })
    expect(topPainters(rows).map((row) => [row.owner, row.pixels, row.paints])).toEqual([
      [A, 35, 2],
      [B, 30, 1],
    ])
  })

  it('rotates prompts on a timer and lets the host step both ways', () => {
    const period = 1_000
    expect(promptIndex(0, 0, 4, period)).toBe(0)
    expect(promptIndex(2_500, 0, 4, period)).toBe(2)
    expect(promptIndex(2_500, 3, 4, period)).toBe(1)
    expect(promptIndex(0, -1, 4, period)).toBe(3)
    expect(promptProgress(2_500, period)).toBeCloseTo(0.5)
    expect(PARTY_PROMPTS.length).toBeGreaterThan(8)
    for (const prompt of PARTY_PROMPTS) expect(prompt.title.length).toBeLessThan(40)
  })

  it('places flashes as percentages of the canvas', () => {
    expect(boxPercent({ x0: 64, y0: 128, x1: 127, y1: 128 })).toEqual({
      left: 25,
      top: 50,
      width: 25,
      height: 100 / 256,
    })
  })

  it('ships a well-formed QR code (25×25 with the three finder squares)', () => {
    expect(QR_ROWS).toHaveLength(25)
    for (const row of QR_ROWS) expect(row).toMatch(/^[01]{25}$/)
    const finder = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111']
    for (let i = 0; i < 7; i++) {
      expect(QR_ROWS[i].slice(0, 7)).toBe(finder[i])
      expect(QR_ROWS[i].slice(18)).toBe(finder[i])
      expect(QR_ROWS[18 + i].slice(0, 7)).toBe(finder[i])
    }
    expect(qrPath(['10'], 2)).toBe('M2 2h1v1h-1z')
  })
})
