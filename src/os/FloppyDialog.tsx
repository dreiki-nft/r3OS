import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { screenSafeMessage } from '../chain/errors'
import { decodeDataUri } from '../lib/dataUri'
import { readLabsToken } from '../labs/labsToken'
import { canvasBmp, frameBmp, resourceFileName, type ImageResource } from './imageResources'
import { closeFloppy, getFloppyRequest, subscribeFloppy } from './floppy'
import { Button } from './ui/Button'
import { Icon } from './ui/Icon'
import { ProgressSegments } from './ui/ProgressSegments'

interface PreparedFile {
  bytes: Uint8Array
  type: string
  description: string
}

const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

async function prepare(resource: ImageResource): Promise<PreparedFile> {
  if (resource.kind === 'frame') {
    const result = await frameBmp(resource.tokenId)
    return {
      bytes: result.bytes,
      type: 'image/bmp',
      description: `${resourceFileName(resource)} · ${result.bytes.length.toLocaleString()} bytes · pixel data copied byte-for-byte from the contract (frameCompositeData), saved at block #${result.blockNumber}`,
    }
  }
  if (resource.kind === 'canvas') {
    const result = canvasBmp()
    const block = result.blockNumber
    return {
      bytes: result.bytes,
      type: 'image/bmp',
      description: `${resourceFileName(resource)} · ${result.bytes.length.toLocaleString()} bytes · ${
        block > 0n ? `the shared canvas as of block #${block}` : 'the latest locally available shared canvas'
      }`,
    }
  }
  const token = await readLabsToken(resource.labsId)
  if (!token.image?.startsWith('data:image/svg+xml')) throw new Error('photo image unavailable')
  const bytes = new TextEncoder().encode(decodeDataUri(token.image))
  return {
    bytes,
    type: 'image/svg+xml',
    description: `${resourceFileName(resource)} · ${bytes.length.toLocaleString()} bytes · drawn onchain by Block Camera`,
  }
}

function saveBlob(file: PreparedFile, name: string) {
  const blob = new Blob([file.bytes.slice().buffer as ArrayBuffer], { type: file.type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Safari needs the URL alive for a while after the click; 40 s is plenty and still frees it.
  window.setTimeout(() => URL.revokeObjectURL(url), 40_000)
}

export function FloppyDialog() {
  const request = useSyncExternalStore(subscribeFloppy, getFloppyRequest)
  const [progress, setProgress] = useState(0)
  const [file, setFile] = useState<PreparedFile>()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!request) return
    let cancelled = false
    let interval: number | undefined
    let finish: number | undefined
    setProgress(0)
    setFile(undefined)
    setError('')
    void prepare(request.resource)
      .then((prepared) => {
        if (cancelled) return
        const duration = reducedMotion() ? 0 : 1_200
        if (duration === 0) {
          setProgress(12)
          setFile(prepared)
          return
        }
        const started = performance.now()
        interval = window.setInterval(() => {
          const elapsed = performance.now() - started
          setProgress(Math.min(12, Math.floor((elapsed / duration) * 12)))
        }, 80)
        finish = window.setTimeout(() => {
          if (interval) window.clearInterval(interval)
          if (cancelled) return
          setProgress(12)
          setFile(prepared)
        }, duration)
      })
      .catch((reason) => {
        if (!cancelled) {
          const safe = screenSafeMessage(reason)
          const subject =
            request.resource.kind === 'frame'
              ? 'frame'
              : request.resource.kind === 'photo'
                ? 'photo'
                : 'canvas'
          setError(
            safe
              ? `this ${subject} couldn't be read right now. try again.\n${safe}`
              : `this ${subject} couldn't be read right now. try again.`,
          )
        }
      })
    return () => {
      cancelled = true
      if (interval) window.clearInterval(interval)
      if (finish) window.clearTimeout(finish)
    }
  }, [request?.id])

  const saveRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Escape closes; focus moves into the dialog (Save file once the copy is done).
  useEffect(() => {
    if (!request) return
    const id = request.id
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      closeFloppy(id)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [request?.id])

  useEffect(() => {
    if (!request) return
    ;(file ? saveRef.current : cancelRef.current)?.focus()
  }, [request?.id, Boolean(file)])

  if (!request) return null
  const name = resourceFileName(request.resource)

  return (
    <div className="floppy-shade">
      <section
        className="floppy-dialog window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="floppy-title"
      >
        <header className="titlebar">
          <Icon name="floppy" size={20} />
          <strong id="floppy-title">Save to Floppy</strong>
          <span className="titlebar-spacer" />
          <button aria-label="Close Save to Floppy" onClick={() => closeFloppy(request.id)}>
            ×
          </button>
        </header>
        <div className="floppy-body">
          <div className="floppy-copy-row">
            <Icon name="floppy" size={48} colour="#5FEDDF" />
            <div>
              <b>{file ? 'Copy complete.' : error ? 'Copy failed.' : `Copying… ${name} to A:\\`}</b>
              {!error && <ProgressSegments value={progress} max={12} />}
            </div>
          </div>
          {file && (
            <>
              <p className="floppy-description">{file.description}</p>
              {request.resource.kind !== 'photo' && <small>a 1.44 MB floppy holds 43 of these.</small>}
            </>
          )}
          {error && <pre className="floppy-error">{error}</pre>}
          <div className="floppy-buttons">
            {file && (
              <Button primary ref={saveRef} onClick={() => saveBlob(file, name)}>
                Save file
              </Button>
            )}
            <Button primary={Boolean(error)} ref={cancelRef} onClick={() => closeFloppy(request.id)}>
              {file || error ? 'Close' : 'Cancel'}
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
