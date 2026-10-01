import { describe, expect, it } from 'vitest'
import type { Address } from 'viem'
import {
  cdInfoText,
  explorerSize,
  explorerTotal,
  HEADER_SIZE,
  LABEL_OFFSET,
  parseCdSnapshot,
  snapshotFromCode,
  TRACK_BMP_BYTES,
  TRACK_SIZE,
  trackFileName,
  volumeLabel,
  win98Date,
  type LoadedCd,
} from './cdrom'
import { currentDisc, ejectDisc, insertDisc } from './cdromStore'
import { imagingTargetFromHash } from './ImagingProgram'

function writeUint(out: Uint8Array, offset: number, length: number, value: bigint) {
  for (let i = length - 1; i >= 0; i--) {
    out[offset + i] = Number(value & 0xffn)
    value >>= 8n
  }
}

/** Mirrors R3tardsCDBurner.burnCD's snapshot layout. */
function buildSnapshot(
  label: string,
  tracks: { id: number; season: number; flags?: number; pair?: number }[],
) {
  const out = new Uint8Array(HEADER_SIZE + tracks.length * TRACK_SIZE)
  out[0] = 2
  out[1] = tracks.length
  out[2] = label.length
  out[3] = 9
  out[4] = 5
  out[5] = 2
  out[6] = tracks.filter((track) => (track.flags ?? 0) & 1).length
  out[7] = tracks.some((track) => (track.flags ?? 0) & 2) ? 1 : 0
  writeUint(out, 8, 32, BigInt(Math.min(...tracks.map((track) => track.id))))
  writeUint(out, 40, 4, BigInt(Math.min(...tracks.map((track) => track.season))))
  writeUint(out, 44, 4, BigInt(Math.max(...tracks.map((track) => track.season))))
  writeUint(out, 48, 2, 0x0510n)
  out.set(new TextEncoder().encode(label), LABEL_OFFSET)
  tracks.forEach((track, index) => {
    const record = HEADER_SIZE + index * TRACK_SIZE
    writeUint(out, record, 32, BigInt(track.id))
    writeUint(out, record + 32, 4, BigInt(track.season))
    out[record + 36] = track.flags ?? 0
    out[record + 37] = track.pair ?? 0
  })
  return out
}

describe('CD snapshot parsing', () => {
  it('reads the header, label and every track record', () => {
    const snapshot = parseCdSnapshot(
      buildSnapshot('my mix', [
        { id: 12, season: 0 },
        { id: 15, season: 0, flags: 1, pair: 0x49 },
        { id: 20, season: 1, flags: 2 },
      ]),
    )
    expect(snapshot.label).toBe('my mix')
    expect(snapshot.trackCount).toBe(3)
    expect(snapshot.oldestTrack).toBe(12)
    expect(snapshot.minSeason).toBe(0)
    expect(snapshot.maxSeason).toBe(1)
    expect(snapshot.discMask).toBe(0x0510)
    expect(snapshot.stormTracks).toBe(1)
    expect(snapshot.hasFinale).toBe(true)
    expect(snapshot.tracks.map((track) => track.frameId)).toEqual([12, 15, 20])
    expect(snapshot.tracks[1]).toMatchObject({ storm: true, finale: false, colourPair: 0x49 })
    expect(snapshot.tracks[2]).toMatchObject({ season: 1, storm: false, finale: true })
  })

  it('handles large frame ids and the 12-track maximum', () => {
    const tracks = Array.from({ length: 12 }, (_, index) => ({ id: 100_000 + index, season: 3 }))
    const snapshot = parseCdSnapshot(buildSnapshot('album', tracks))
    expect(snapshot.tracks.at(-1)?.frameId).toBe(100_011)
  })

  it('rejects malformed snapshots', () => {
    const good = buildSnapshot('x', [{ id: 1, season: 0 }])
    expect(() => parseCdSnapshot(good.slice(0, 40))).toThrow()
    const badVersion = good.slice()
    badVersion[0] = 1
    expect(() => parseCdSnapshot(badVersion)).toThrow(/version/)
    const badCount = good.slice()
    badCount[1] = 2
    expect(() => parseCdSnapshot(badCount)).toThrow(/length/)
    const zero = good.slice()
    zero[1] = 0
    expect(() => parseCdSnapshot(zero)).toThrow(/track count/)
  })

  it('strips the STOP byte from pointer code', () => {
    const snapshot = buildSnapshot('x', [{ id: 1, season: 0 }])
    const code = new Uint8Array(snapshot.length + 1)
    code.set(snapshot, 1)
    expect(snapshotFromCode(code)).toEqual(snapshot)
    expect(() => snapshotFromCode(new Uint8Array([0x60, 0x00]))).toThrow()
  })
})

describe('Explorer formatting', () => {
  it('names tracks like a Win98 CD', () => {
    expect(trackFileName(0)).toBe('TRACK01.BMP')
    expect(trackFileName(11)).toBe('TRACK12.BMP')
  })

  it('uppercases and bounds the volume label', () => {
    expect(volumeLabel('my mix')).toBe('MY MIX')
    expect(volumeLabel('a very long label for a cd')).toBe('A VERY LONG LABE')
    expect(volumeLabel('   ')).toBe('CD-R')
  })

  it('sizes a 256×256 4-bit BMP and totals', () => {
    expect(TRACK_BMP_BYTES).toBe(32_886)
    expect(explorerSize(TRACK_BMP_BYTES)).toBe('33KB')
    expect(explorerSize(612)).toBe('1KB')
    expect(explorerTotal(3 * TRACK_BMP_BYTES + 612)).toBe('96.9KB')
  })

  it('formats dates the Win98 way', () => {
    expect(win98Date(1790808823, 'UTC')).toBe('9/30/26 10:53 PM')
  })

  it('writes CDINFO.TXT from the snapshot', () => {
    const cd: LoadedCd = {
      tokenId: 5n,
      snapshot: parseCdSnapshot(
        buildSnapshot('my mix', [
          { id: 12, season: 0 },
          { id: 15, season: 1, flags: 1 },
        ]),
      ),
      pointer: '0x0000000000000000000000000000000000000abc' as Address,
      mintBlock: 150000n,
      burner: '0x00000000000000000000000000000000000000aa' as Address,
      frames: new Map(),
      frameTimestamps: new Map(),
    }
    const text = cdInfoText(cd, new Map([[15, { recycled: true }]]))
    expect(text).toContain('r3tards labs cd #5')
    expect(text).toContain('label ......... my mix')
    expect(text).toContain('seasons ....... 1–2')
    expect(text).toContain('TRACK01.BMP  frame #12  season 1')
    expect(text).toContain('TRACK02.BMP  frame #15  season 2  storm recycled')
    expect(text).toContain('block 150000')
  })
})

describe('drive and viewer state', () => {
  it('parses Imaging deep links (1-based track in the URL)', () => {
    expect(imagingTargetFromHash('#/imaging?cd=5&track=2')).toEqual({ cdId: '5', track: 1 })
    expect(imagingTargetFromHash('#/imaging?cd=5')).toEqual({ cdId: '5', track: 0 })
    expect(imagingTargetFromHash('#/imaging?cd=x&track=2')).toBeUndefined()
    expect(imagingTargetFromHash('#/imaging?cd=5&track=0')).toBeUndefined()
    expect(imagingTargetFromHash('#/cdrom')).toBeUndefined()
  })

  it('inserts and ejects a disc per wallet (session fallback without localStorage)', () => {
    const a = '0x00000000000000000000000000000000000000aa' as Address
    const b = '0x00000000000000000000000000000000000000bb' as Address
    insertDisc(a, { tokenId: '5', label: 'my mix' })
    expect(currentDisc(a)).toEqual({ tokenId: '5', label: 'my mix' })
    expect(currentDisc(b)).toBeUndefined()
    ejectDisc(a)
    expect(currentDisc(a)).toBeUndefined()
  })
})
