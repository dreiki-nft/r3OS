import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { getCanvasSnapshot, subscribeCanvas } from '../paint/canvasStore'
import { getWallpaper, subscribeWallpaper, wallpaperDataUrl } from './wallpaper'

export function WallpaperLayer() {
  const setting = useSyncExternalStore(subscribeWallpaper, getWallpaper)
  const [url, setUrl] = useState<string>()

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    let pending = false
    let lastCanvasRender = 0
    // The canvas store also emits for new blocks with no new paint; only redraw when the pixels changed.
    let lastPixels: Uint8Array | undefined

    const render = async () => {
      if (!setting.resource) {
        setUrl(undefined)
        return
      }
      try {
        const next = await wallpaperDataUrl(setting.resource)
        if (!cancelled) {
          setUrl(next)
          if (setting.resource.kind === 'canvas') lastCanvasRender = performance.now()
        }
      } catch {
        if (!cancelled) setUrl(undefined)
      }
    }

    const scheduleCanvasRender = () => {
      if (document.hidden || pending) return
      const pixels = getCanvasSnapshot().background
      if (pixels === lastPixels) return
      lastPixels = pixels
      const wait = Math.max(0, 2_000 - (performance.now() - lastCanvasRender))
      pending = true
      timer = window.setTimeout(() => {
        pending = false
        if (document.hidden) return
        void render()
      }, wait)
    }

    void render()
    let unsubscribe = () => {}
    const onVisibility = () => {
      if (!document.hidden && setting.resource?.kind === 'canvas') scheduleCanvasRender()
    }
    if (setting.resource?.kind === 'canvas') {
      unsubscribe = subscribeCanvas(scheduleCanvasRender)
      document.addEventListener('visibilitychange', onVisibility)
    }
    return () => {
      cancelled = true
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisibility)
      if (timer) window.clearTimeout(timer)
    }
  }, [setting.resource])

  const custom = Boolean(setting.resource && url)
  const style: CSSProperties | undefined = custom
    ? setting.mode === 'tile'
      ? {
          backgroundImage: `url(${JSON.stringify(url)})`,
          backgroundRepeat: 'repeat',
          backgroundSize: '256px 256px',
        }
      : setting.mode === 'stretch'
        ? {
            backgroundImage: `url(${JSON.stringify(url)})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: '100% 100%',
            backgroundPosition: 'center',
          }
        : {
            backgroundImage: `url(${JSON.stringify(url)})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: 'auto',
            backgroundPosition: 'center',
          }
    : undefined

  return <div className={`wallpaper ${custom ? 'custom-wallpaper' : ''}`} style={style} aria-hidden="true" />
}
