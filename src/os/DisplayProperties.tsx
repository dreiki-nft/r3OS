import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { mineTokenIds } from '../frames/framesStore'
import { getCanvasSnapshot, subscribeCanvas } from '../paint/canvasStore'
import { Button } from './ui/Button'
import { Tabs } from './ui/Tabs'
import { closeWindow } from './windows'
import { useWindowActive } from './Window'
import {
  getSessionPhoto,
  getWallpaper,
  setWallpaper,
  subscribeSessionPhoto,
  subscribeWallpaper,
  wallpaperDataUrl,
  type WallpaperMode,
  type WallpaperSetting,
} from './wallpaper'
import {
  getScreensaverSetting,
  requestScreensaverPreview,
  setScreensaverSetting,
  subscribeScreensaverSetting,
  type ScreensaverSetting,
} from './screensaver'
import { resourceLabel, type ImageResource } from './imageResources'

function sameResource(a?: ImageResource, b?: ImageResource) {
  if (!a || !b) return a === b
  if (a.kind !== b.kind) return false
  if (a.kind === 'frame' && b.kind === 'frame') return a.tokenId === b.tokenId
  if (a.kind === 'photo' && b.kind === 'photo') return a.labsId === b.labsId
  return a.kind === 'canvas' && b.kind === 'canvas'
}

function resourceKey(resource?: ImageResource) {
  if (!resource) return 'none'
  if (resource.kind === 'frame') return `frame:${resource.tokenId}`
  if (resource.kind === 'photo') return `photo:${resource.labsId}`
  return 'canvas'
}

function useNarrowOrTouch() {
  const read = () =>
    typeof matchMedia !== 'undefined' &&
    (matchMedia('(max-width: 640px)').matches || matchMedia('(pointer: coarse)').matches)
  const [value, setValue] = useState(read)
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const queries = [matchMedia('(max-width: 640px)'), matchMedia('(pointer: coarse)')]
    const update = () => setValue(read())
    for (const query of queries) query.addEventListener?.('change', update)
    return () => {
      for (const query of queries) query.removeEventListener?.('change', update)
    }
  }, [])
  return value
}

function wallpaperOptions(frames: readonly number[], photo?: bigint) {
  const options: Array<{ label: string; resource?: ImageResource }> = [
    { label: '(None) r3tards' },
    { label: 'Live canvas', resource: { kind: 'canvas' } },
  ]
  for (const tokenId of frames.filter((id) => id > 0).slice(0, 50)) {
    options.push({ label: `Frame #${tokenId}`, resource: { kind: 'frame', tokenId } })
  }
  if (photo != null) options.push({ label: `Photo #${photo}`, resource: { kind: 'photo', labsId: photo } })
  return options
}

export function DisplayProperties() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const current = useSyncExternalStore(subscribeWallpaper, getWallpaper)
  const sessionPhoto = useSyncExternalStore(subscribeSessionPhoto, getSessionPhoto)
  const savedScreensaver = useSyncExternalStore(subscribeScreensaverSetting, getScreensaverSetting)
  // Re-render the preview when the selected Live canvas changes. This uses the already-running canvas store.
  const canvas = useSyncExternalStore(subscribeCanvas, getCanvasSnapshot)
  const [tab, setTab] = useState('Background')
  const [frames, setFrames] = useState<number[]>([])
  const [draft, setDraft] = useState<WallpaperSetting>(() => current)
  const [screenDraft, setScreenDraft] = useState<ScreensaverSetting>(() => savedScreensaver)
  const [preview, setPreview] = useState<string>()
  const narrowOrTouch = useNarrowOrTouch()

  useEffect(() => {
    if (!wallet.account) {
      setFrames([])
      return
    }
    let cancelled = false
    void mineTokenIds(wallet.account)
      .then((ids) => !cancelled && setFrames([...ids].sort((a, b) => b - a)))
      .catch(() => !cancelled && setFrames([]))
    return () => {
      cancelled = true
    }
  }, [wallet.account])

  const options = useMemo(() => wallpaperOptions(frames, sessionPhoto), [frames, sessionPhoto])

  useEffect(() => {
    let cancelled = false
    if (!draft.resource) {
      setPreview('/os/wallpaper/wallpaper-dark.webp')
      return
    }
    void wallpaperDataUrl(draft.resource)
      .then((url) => !cancelled && setPreview(url))
      .catch(() => !cancelled && setPreview(undefined))
    return () => {
      cancelled = true
    }
    // Only real pixel changes re-render a live-canvas preview (not every new block).
  }, [resourceKey(draft.resource), draft.resource?.kind === 'canvas' ? canvas.background : null])

  const apply = () => {
    setWallpaper(draft)
    setScreensaverSetting(screenDraft)
  }

  const cancel = () => {
    setDraft(current)
    setScreenDraft(savedScreensaver)
    closeWindow('display-props')
  }

  // Escape = Cancel, like a Win98 dialog, while this window is the active one.
  const active = useWindowActive()
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="display-properties" role="dialog" aria-labelledby="display-properties-title">
      <h2 id="display-properties-title" className="os-visually-hidden">
        Display Properties
      </h2>
      <Tabs tabs={['Background', 'Screen Saver']} active={tab} onChange={setTab} />
      <div className="display-properties-page">
        {tab === 'Background' ? (
          <>
            <div className="display-monitor" aria-label="Wallpaper preview">
              <div className={`display-monitor-screen mode-${draft.mode}`}>
                {preview && <div style={{ backgroundImage: `url(${JSON.stringify(preview)})` }} />}
              </div>
              <i />
              <b />
            </div>
            <div className="display-background-controls">
              <label>Wallpaper:</label>
              <div className="display-wallpaper-list listbox sunken" role="listbox" aria-label="Wallpaper">
                {options.map((option) => {
                  const selected = sameResource(option.resource, draft.resource)
                  return (
                    <button
                      key={resourceKey(option.resource)}
                      role="option"
                      aria-selected={selected}
                      className={selected ? 'selected' : ''}
                      onClick={() => setDraft((value) => ({ ...value, resource: option.resource }))}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
              <fieldset className="display-mode">
                <legend>Display</legend>
                {(['tile', 'center', 'stretch'] as WallpaperMode[]).map((mode) => (
                  <label key={mode}>
                    <input
                      type="radio"
                      name="wallpaper-mode"
                      checked={draft.mode === mode}
                      onChange={() => setDraft((value) => ({ ...value, mode }))}
                    />
                    {mode[0].toUpperCase() + mode.slice(1)}
                  </label>
                ))}
              </fieldset>
              <small>{draft.resource ? resourceLabel(draft.resource) : 'default r3tardOS wallpaper'}</small>
            </div>
          </>
        ) : (
          <div className="display-screensaver-page">
            <div className="display-monitor screensaver-preview-monitor">
              <div className="display-monitor-screen screensaver-mini">
                <span>{screenDraft === 'canvas' ? 'r3tardOS Canvas' : 'None'}</span>
              </div>
              <i />
              <b />
            </div>
            <div>
              <label htmlFor="screensaver-choice">Screen saver:</label>
              <select
                id="screensaver-choice"
                value={screenDraft}
                disabled={narrowOrTouch}
                onChange={(event) => setScreenDraft(event.target.value as ScreensaverSetting)}
              >
                <option value="none">(None)</option>
                <option value="canvas">r3tardOS Canvas</option>
              </select>
              <p>Wait: 3 minutes</p>
              <Button disabled={screenDraft === 'none' || narrowOrTouch} onClick={requestScreensaverPreview}>
                Preview
              </Button>
              <p className="muted">
                {narrowOrTouch ? 'screen saver is desktop only' : 'desktop only · any input wakes it'}
              </p>
            </div>
          </div>
        )}
      </div>
      <div className="display-properties-buttons">
        <Button onClick={cancel}>Cancel</Button>
        <Button onClick={apply}>Apply</Button>
        <Button
          primary
          onClick={() => {
            apply()
            closeWindow('display-props')
          }}
        >
          OK
        </Button>
      </div>
    </div>
  )
}
