import { describe, expect, it } from 'vitest'
import { parseWallpaper, serializeWallpaper } from './wallpaper'

describe('wallpaper preference', () => {
  it('persists only a resource reference and mode', () => {
    expect(
      serializeWallpaper({ resource: { kind: 'photo', labsId: 42n }, mode: 'tile' }),
    ).toBe('{"kind":"photo","labsId":"42","mode":"tile"}')
    expect(parseWallpaper('{"kind":"photo","labsId":"42","mode":"stretch"}')).toEqual({
      resource: { kind: 'photo', labsId: 42n },
      mode: 'stretch',
    })
  })

  it('falls back safely for malformed or unsupported settings', () => {
    expect(parseWallpaper('{oops')).toEqual({ mode: 'center' })
    expect(parseWallpaper('{"kind":"frame","tokenId":-1,"mode":"tile"}')).toEqual({ mode: 'tile' })
    expect(parseWallpaper('{"kind":"frame","tokenId":0,"mode":"center"}')).toEqual({ mode: 'center' })
    expect(parseWallpaper('{"kind":"frame","tokenId":9007199254740992,"mode":"center"}')).toEqual({ mode: 'center' })
    expect(parseWallpaper('{"kind":"photo","labsId":"0","mode":"center"}')).toEqual({ mode: 'center' })
    expect(
      parseWallpaper(
        '{"kind":"photo","labsId":"115792089237316195423570985008687907853269984665640564039457584007913129639936","mode":"center"}',
      ),
    ).toEqual({ mode: 'center' })
    expect(parseWallpaper('{"kind":"frame","tokenId":7,"mode":"wat"}')).toEqual({
      resource: { kind: 'frame', tokenId: 7 },
      mode: 'center',
    })
  })
})
