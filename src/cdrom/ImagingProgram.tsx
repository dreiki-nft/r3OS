import { useEffect, useState, useSyncExternalStore } from 'react'
import { getFrameImage, type PixelImage } from '../frames/frameImage'
import { PixelPreview } from '../frames/PixelPreview'
import { playSound } from '../os/sound'
import { requestFloppy } from '../os/floppy'
import { applyWallpaperResource } from '../os/wallpaper'
import { Button } from '../os/ui/Button'
import { Icon } from '../os/ui/Icon'
import { SafeImage } from '../os/ui/SafeImage'
import { closeWindow } from '../os/windows'
import {
  loadCd,
  shortAddress,
  trackFileName,
  trackStatuses,
  volumeLabel,
  win98Date,
  type LoadedCd,
  type TrackStatus,
} from './cdrom'
import { getCdromVersion, getImagingTarget, setImagingTarget, subscribeCdrom } from './cdromStore'
import './cdrom.css'

type Zoom = 'fit' | 1 | 2

/** `#/imaging?cd=5&track=2` deep link (track is 1-based in the URL). */
export function imagingTargetFromHash(hash: string) {
  if (!hash.startsWith('#/imaging')) return undefined
  const params = new URLSearchParams(hash.split('?')[1] ?? '')
  const cd = params.get('cd')
  const track = Number(params.get('track') ?? '1')
  if (!cd || !/^\d+$/.test(cd) || !Number.isInteger(track) || track < 1) return undefined
  return { cdId: cd, track: track - 1 }
}

export function ImagingProgram() {
  useSyncExternalStore(subscribeCdrom, getCdromVersion)
  const target =
    getImagingTarget() ?? imagingTargetFromHash(typeof location === 'undefined' ? '' : location.hash)
  const [cd, setCd] = useState<LoadedCd>()
  const [image, setImage] = useState<PixelImage>()
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [properties, setProperties] = useState(false)
  const [statuses, setStatuses] = useState<Map<number, TrackStatus>>(new Map())

  useEffect(() => {
    if (!target) return
    let cancelled = false
    setError('')
    loadCd(BigInt(target.cdId))
      .then(async (loaded) => {
        if (cancelled) return
        setCd(loaded)
        const frameIds = loaded.snapshot.tracks
          .filter((track) => track.kind === 'frame')
          .map((track) => track.sourceId)
        const next = await trackStatuses(frameIds).catch(() => new Map<number, TrackStatus>())
        if (!cancelled) setStatuses(next)
      })
      .catch((cause) => !cancelled && setError(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      cancelled = true
    }
  }, [target?.cdId])

  const track =
    cd && target ? cd.snapshot.tracks[Math.min(target.track, cd.snapshot.trackCount - 1)] : undefined

  useEffect(() => {
    if (!track || track.kind !== 'frame') {
      setImage(undefined)
      return
    }
    let cancelled = false
    setImage(undefined)
    getFrameImage(track.sourceId)
      .then((next) => !cancelled && setImage(next))
      .catch((cause) => !cancelled && setError(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      cancelled = true
    }
  }, [track?.kind, track?.sourceId])

  const go = (step: number) => {
    if (!cd || !target) return
    const next = (target.track + step + cd.snapshot.trackCount) % cd.snapshot.trackCount
    playSound('select')
    setImagingTarget({ cdId: target.cdId, track: next })
  }

  if (!target) {
    return (
      <div className="imaging-program">
        <p className="cdrom-empty">open a track from CD-ROM (D:) to view it.</p>
      </div>
    )
  }

  const info = track?.kind === 'frame' ? cd?.frames.get(track.sourceId) : undefined
  const status = track?.kind === 'frame' ? statuses.get(track.sourceId) : undefined
  const photo = track?.kind === 'block-photo' ? cd?.photos.get(track.sourceId) : undefined
  const minted =
    track?.kind === 'frame'
      ? cd?.frameTimestamps.get(track.sourceId)
      : Number(photo?.attributes.Timestamp ?? 0) || undefined
  const size = zoom === 'fit' ? undefined : 256 * zoom
  const name = track ? trackFileName(track.index, track.kind) : 'TRACK??.BMP'
  const wallpaperResource =
    track?.kind === 'block-photo'
      ? ({ kind: 'photo', labsId: BigInt(track.sourceId) } as const)
      : track
        ? ({ kind: 'frame', tokenId: track.sourceId } as const)
        : undefined

  return (
    <div className="imaging-program">
      <div className="cdrom-toolbar raised">
        <Button onClick={() => go(-1)} disabled={!cd || cd.snapshot.trackCount < 2}>
          ◀ Previous
        </Button>
        <Button onClick={() => go(1)} disabled={!cd || cd.snapshot.trackCount < 2}>
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
        <Button disabled={!wallpaperResource} onClick={() => wallpaperResource && applyWallpaperResource(wallpaperResource)}>
          Set as Wallpaper
        </Button>
        <Button disabled={!wallpaperResource} onClick={() => wallpaperResource && requestFloppy(wallpaperResource)}>
          Save to Floppy…
        </Button>
        <Button onClick={() => setProperties((open) => !open)}>Properties</Button>
        <span className="imaging-title">
          {name} - {cd ? `${volumeLabel(cd.snapshot.label)} (D:)` : 'D:'}
        </span>
      </div>

      <div className="imaging-body">
        <main className={`imaging-canvas sunken ${zoom === 'fit' ? 'fit' : ''}`}>
          {track?.kind === 'block-photo' && photo?.image ? (
            <SafeImage
              src={photo.image}
              alt={photo.name ?? `block photo #${track.sourceId}`}
              width={size ?? 256}
              height={size ?? 256}
              className={zoom === 'fit' ? 'imaging-fit' : ''}
            />
          ) : image ? (
            <PixelPreview image={image} size={size ?? 256} className={zoom === 'fit' ? 'imaging-fit' : ''} />
          ) : (
            <p className="cdrom-empty">{error ? `could not read ${name}: ${error}` : `reading ${name}…`}</p>
          )}
        </main>
        {properties && track && (
          <aside className="imaging-properties raised">
            <h3>
              <Icon name="gallery" size={24} colour="#EE93E3" /> {name}
            </h3>
            <dl>
              <dt>Type</dt>
              <dd>{track.kind === 'frame' ? 'Bitmap Image · 256 × 256 · 16 colours' : 'Onchain SVG · 32 × 32 Block Camera portrait'}</dd>
              <dt>Location</dt>
              <dd>
                D:\ · cd #{cd?.tokenId.toString()} · track {track.index + 1}
              </dd>
              <dt>Source</dt>
              <dd>{track.kind === 'frame' ? `frame #${track.sourceId}` : `block photo #${track.sourceId}`}</dd>
              <dt>Season</dt>
              <dd>
                {track.season + 1}
                {track.storm ? ' · storm' : ''}
                {track.finale ? ' · finale' : ''}
              </dd>
              <dt>Created</dt>
              <dd>
                {track.kind === 'frame'
                  ? info
                    ? `block ${info.blockNumber}`
                    : '—'
                  : `block ${String(photo?.attributes.Block ?? '—')}`}
                {minted ? ` · ${win98Date(minted)}` : ''}
              </dd>
              <dt>{track.kind === 'frame' ? 'Frame now' : 'Photo source'}</dt>
              <dd>
                {track.kind === 'block-photo'
                  ? 'immutable r3tards Labs Block Camera NFT'
                  : status?.recycled
                    ? 'recycled · its pixels are still onchain'
                    : status?.owner
                      ? `owned by ${shortAddress(status.owner)}`
                      : '—'}
              </dd>
              <dt>Burned by</dt>
              <dd>{shortAddress(cd?.burner)}</dd>
            </dl>
          </aside>
        )}
      </div>

      <footer className="cdrom-status">
        <span>{cd && track ? `Page ${track.index + 1} of ${cd.snapshot.trackCount}` : ''}</span>
        <span>
          {track
            ? `${track.kind === 'frame' ? 'frame' : 'block photo'} #${track.sourceId} · season ${track.season + 1}`
            : ''}
        </span>
        <span>
          <Button onClick={() => closeWindow('imaging')}>Close</Button>
        </span>
      </footer>
    </div>
  )
}
