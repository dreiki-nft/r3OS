import { useEffect, useState } from 'react'
import { getFrameImage, type PixelImage } from '../frames/frameImage'
import { getFrameInfo, type FrameInfo } from '../frames/framesStore'
import { PixelPreview } from '../frames/PixelPreview'
import { requestFloppy } from '../os/floppy'
import { openProgram } from '../os/programs'
import { playSound } from '../os/sound'
import { Button } from '../os/ui/Button'
import { applyWallpaperResource } from '../os/wallpaper'
import { closeWindow } from '../os/windows'
import { setImagingTarget, type FrameImagingTarget } from './cdromStore'
import './cdrom.css'

type Zoom = 'fit' | 1 | 2

/** FRAME0042.BMP: the name My Frames' viewer gives a frame. */
export const frameFileName = (tokenId: number) => `FRAME${String(tokenId).padStart(4, '0')}.BMP`

/** The step from `index` through a list of `count`, wrapping at both ends. */
export const stepIndex = (index: number, step: number, count: number) =>
  count ? (index + step + count) % count : 0

/** A frame opened from My Frames: the picture itself, with Previous/Next through the folder it came from. */
export function FrameImaging({ target }: { target: FrameImagingTarget }) {
  const index = Math.min(Math.max(0, target.index), target.frames.length - 1)
  const tokenId = target.frames[index]
  const [image, setImage] = useState<PixelImage>()
  const [info, setInfo] = useState<FrameInfo>()
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState<Zoom>('fit')

  useEffect(() => {
    let cancelled = false
    setImage(undefined)
    setInfo(undefined)
    setError('')
    getFrameImage(tokenId)
      .then((next) => !cancelled && setImage(next))
      .catch((cause) => !cancelled && setError(cause instanceof Error ? cause.message : String(cause)))
    getFrameInfo(tokenId)
      .then((next) => !cancelled && setInfo(next))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [tokenId])

  const go = (step: number) => {
    playSound('select')
    setImagingTarget({ frames: target.frames, index: stepIndex(index, step, target.frames.length) })
  }

  const name = frameFileName(tokenId)
  const size = zoom === 'fit' ? undefined : 256 * zoom
  const resource = { kind: 'frame', tokenId } as const
  const many = target.frames.length > 1

  return (
    <div className="imaging-program">
      <div className="cdrom-toolbar raised">
        <Button onClick={() => go(-1)} disabled={!many}>
          ◀ Previous
        </Button>
        <Button onClick={() => go(1)} disabled={!many}>
          Next ▶
        </Button>
        <span className="cdrom-toolbar-sep" />
        <Button onClick={() => setZoom('fit')} disabled={zoom === 'fit'}>
          Best Fit
        </Button>
        <Button onClick={() => setZoom(1)} disabled={zoom === 1}>
          100%
        </Button>
        <Button onClick={() => setZoom(2)} disabled={zoom === 2}>
          200%
        </Button>
        <span className="cdrom-toolbar-sep" />
        <Button onClick={() => applyWallpaperResource(resource)}>Set as Wallpaper</Button>
        <Button onClick={() => requestFloppy(resource)}>Save to Floppy…</Button>
        <Button
          onClick={() =>
            openProgram(
              'frame-props',
              true,
              `#/frame-props?${new URLSearchParams({ token: String(tokenId), tab: 'General' })}`,
            )
          }
        >
          Properties
        </Button>
        <span className="imaging-title">{name} - My Frames</span>
      </div>

      <div className="imaging-body">
        <main className={`imaging-canvas sunken ${zoom === 'fit' ? 'fit' : ''}`}>
          {image ? (
            <PixelPreview image={image} size={size ?? 256} className={zoom === 'fit' ? 'imaging-fit' : ''} />
          ) : (
            <p className="cdrom-empty">{error ? `could not read ${name}: ${error}` : `reading ${name}…`}</p>
          )}
        </main>
      </div>

      <footer className="cdrom-status">
        <span>{many ? `Frame ${index + 1} of ${target.frames.length}` : ''}</span>
        <span>
          frame #{tokenId}
          {info ? ` · season ${info.season + 1} · block ${info.blockNumber}` : ''}
        </span>
        <span>
          <Button onClick={() => closeWindow('imaging')}>Close</Button>
        </span>
      </footer>
    </div>
  )
}
