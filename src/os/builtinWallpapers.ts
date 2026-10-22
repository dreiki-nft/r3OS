/**
 * Wallpapers that ship with r3OS, drawn in the Paint contract's 16 colours (public/os/wallpaper/*.webp,
 * 1600×932: 400×233 pixel art at 4×). They are picked in Display Properties like any other wallpaper.
 */
export interface BuiltinWallpaper {
  id: string
  label: string
  file: string
}

export const BUILTIN_WALLPAPERS: readonly BuiltinWallpaper[] = [
  { id: 'the-eye', label: 'The Eye', file: '/os/wallpaper/the-eye.webp' },
  { id: 'df1-storm', label: 'DF1 Storm', file: '/os/wallpaper/df1-storm.webp' },
  { id: 'monad-purple', label: 'Monad Purple', file: '/os/wallpaper/monad-purple.webp' },
  { id: 'confetti', label: 'Confetti', file: '/os/wallpaper/confetti.webp' },
  { id: 'block-rain', label: 'Block Rain', file: '/os/wallpaper/block-rain.webp' },
  { id: 'pixel-sunset', label: 'Pixel Sunset', file: '/os/wallpaper/pixel-sunset.webp' },
  { id: 'nad-night', label: 'Nad Night', file: '/os/wallpaper/nad-night.webp' },
]

export function builtinWallpaper(id?: string) {
  return id ? BUILTIN_WALLPAPERS.find((wallpaper) => wallpaper.id === id) : undefined
}
