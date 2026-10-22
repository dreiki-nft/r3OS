import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BUILTIN_WALLPAPERS } from '../src/os/builtinWallpapers'

describe('built-in wallpapers', () => {
  it('every one has its file in public/, and ids are unique', () => {
    for (const wallpaper of BUILTIN_WALLPAPERS)
      expect(existsSync(new URL(`../public${wallpaper.file}`, import.meta.url)), wallpaper.file).toBe(true)
    expect(new Set(BUILTIN_WALLPAPERS.map((w) => w.id)).size).toBe(BUILTIN_WALLPAPERS.length)
  })
})
