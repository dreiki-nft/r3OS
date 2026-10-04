import { useEffect, useRef, type PointerEvent } from 'react'
import { recordPerfSampled } from '../chain/perf'
import { PALETTE } from '../lib/palette'
import type { Point } from '../lib/paintEngine'
import type { TilePreviewState } from './cost'
import type { Box, Ping } from './presence'

interface CanvasViewProps {
  pixels: Uint8Array
  outline: Uint8Array
  face: number
  background: number
  zoom: number
  grid: boolean
  protectedView: boolean
  showHeat: boolean
  tileStates: Map<number, TilePreviewState>
  maxHeat: number
  selection?: { x0: number; y0: number; x1: number; y1: number }
  /** short-lived outlines where someone just painted (drawn over the pixels, never into them) */
  pings?: readonly Ping[]
  /** scroll so this box is in view when its id changes */
  focus?: { id: number; box: Box }
  /** live remote event whose pixels should be visible after this draw effect completes */
  renderProbe?: { key: string; observedAt: number }
  /** which pointer transition is expected to mutate pixels, for local input → rendered-canvas timing */
  previewInputMode?: 'down' | 'stroke' | 'up'
  onRenderProbe?: (key: string, latencyMs: number) => void
  onDown: (point: Point, event: PointerEvent<HTMLCanvasElement>) => void
  onMove: (point: Point, event: PointerEvent<HTMLCanvasElement>) => void
  onUp: (point: Point, event: PointerEvent<HTMLCanvasElement>) => void
  onHover: (point: Point) => void
}

export function CanvasView({
  pixels,
  outline,
  face,
  background,
  zoom,
  grid,
  protectedView,
  showHeat,
  tileStates,
  maxHeat,
  selection,
  pings,
  focus,
  renderProbe,
  previewInputMode,
  onRenderProbe,
  onDown,
  onMove,
  onUp,
  onHover,
}: CanvasViewProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const well = useRef<HTMLDivElement>(null)
  const renderedProbe = useRef<string | undefined>(undefined)
  const pendingPaintInputAt = useRef<number | undefined>(undefined)
  const perfNow = () => (typeof performance === 'undefined' ? Date.now() : performance.now())

  useEffect(() => {
    const host = well.current
    if (!focus || !host) return
    const scale = (ref.current?.clientWidth ?? 256 * zoom) / 256
    const cx = ((focus.box.x0 + focus.box.x1 + 1) / 2) * scale
    const cy = ((focus.box.y0 + focus.box.y1 + 1) / 2) * scale
    host.scrollTo?.({ left: cx - host.clientWidth / 2, top: cy - host.clientHeight / 2, behavior: 'smooth' })
  }, [focus?.id])

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const rasterStarted = perfNow()
    const image = context.createImageData(256, 256)
    for (let index = 0; index < pixels.length; index++) {
      const paletteIndex = outline[index] ? face : pixels[index] === 0 ? background : pixels[index]
      let [red, green, blue] = PALETTE[paletteIndex].rgb
      const offset = index * 4

      if (showHeat) {
        const x = index % 256
        const y = (index / 256) | 0
        const tile = (y >> 4) * 16 + (x >> 4)
        const state = tileStates.get(tile)
        if (state) {
          const bit = BigInt((y & 15) * 16 + (x & 15))
          if (((state.wetBitmap >> bit) & 1n) !== 0n) {
            red = Math.round(red * 0.72)
            green = Math.min(255, Math.round(green * 0.88 + 35))
            blue = Math.min(255, Math.round(blue * 0.88 + 55))
          }
          const heat = maxHeat ? Math.min(1, state.heat / maxHeat) : 0
          red = Math.min(255, Math.round(red + 90 * heat))
          green = Math.round(green * (1 - 0.25 * heat))
          blue = Math.round(blue * (1 - 0.35 * heat))
        }
      }

      image.data[offset] = red
      image.data[offset + 1] = green
      image.data[offset + 2] = blue
      image.data[offset + 3] = 255
      if (protectedView && outline[index] && (((index % 256) + ((index / 256) | 0)) & 3) === 0) {
        image.data[offset] = 254
        image.data[offset + 1] = 195
        image.data[offset + 2] = 67
      }
    }
    context.putImageData(image, 0, 0)
    const rasterEnded = perfNow()
    recordPerfSampled(
      'canvas-raster',
      showHeat ? '256×256 raster + heat' : '256×256 raster',
      rasterEnded - rasterStarted,
      8,
    )

    const overlayStarted = rasterEnded
    if (selection) {
      context.save()
      context.setLineDash([2, 2])
      context.strokeStyle = '#fff'
      context.lineWidth = 1 / zoom
      context.strokeRect(
        selection.x0 + 0.5,
        selection.y0 + 0.5,
        selection.x1 - selection.x0 + 1,
        selection.y1 - selection.y0 + 1,
      )
      context.restore()
    }

    if (pings?.length) {
      context.save()
      context.lineWidth = 1
      for (const ping of pings) {
        const { x0, y0, x1, y1 } = ping.box
        context.strokeStyle = '#000'
        context.strokeRect(x0 - 1.5, y0 - 1.5, x1 - x0 + 4, y1 - y0 + 4)
        context.strokeStyle = ping.self ? '#FEC343' : '#5FEDDF'
        context.strokeRect(x0 - 0.5, y0 - 0.5, x1 - x0 + 2, y1 - y0 + 2)
      }
      context.restore()
    }

    if (grid && zoom >= 4) {
      context.strokeStyle = 'rgba(255,255,255,.08)'
      context.lineWidth = 1 / zoom
      for (let n = 0; n <= 256; n++) {
        context.beginPath()
        context.moveTo(n, 0)
        context.lineTo(n, 256)
        context.stroke()
        context.beginPath()
        context.moveTo(0, n)
        context.lineTo(256, n)
        context.stroke()
      }
    }

    const renderedAt = perfNow()
    if (selection || pings?.length || (grid && zoom >= 4)) {
      recordPerfSampled('canvas-overlay', 'selection/pings/grid', renderedAt - overlayStarted, 8)
    }

    const inputAt = pendingPaintInputAt.current
    if (inputAt != null) {
      pendingPaintInputAt.current = undefined
      recordPerfSampled('input-preview', 'pointer event → rendered canvas', Math.max(0, renderedAt - inputAt), 4)
    }

    if (renderProbe && renderProbe.key !== renderedProbe.current) {
      renderedProbe.current = renderProbe.key
      onRenderProbe?.(renderProbe.key, Math.max(0, renderedAt - renderProbe.observedAt))
    }
  }, [
    pixels,
    outline,
    face,
    background,
    grid,
    protectedView,
    zoom,
    showHeat,
    tileStates,
    maxHeat,
    selection,
    pings,
    renderProbe?.key,
    renderProbe?.observedAt,
    onRenderProbe,
  ])

  const point = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(255, Math.floor(((event.clientX - rect.left) * 256) / rect.width))),
      y: Math.max(0, Math.min(255, Math.floor(((event.clientY - rect.top) * 256) / rect.height))),
    }
  }

  const markPaintInput = () => {
    pendingPaintInputAt.current ??= perfNow()
  }

  const finish = (event: PointerEvent<HTMLCanvasElement>) => {
    if (previewInputMode === 'up') markPaintInput()
    onUp(point(event), event)
  }

  return (
    <div
      ref={well}
      className="canvas-well sunken"
      onWheel={(event) => {
        if (event.ctrlKey) event.preventDefault()
      }}
    >
      <canvas
        ref={ref}
        width={256}
        height={256}
        style={{ width: 256 * zoom, height: 256 * zoom }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          if (previewInputMode === 'down' || previewInputMode === 'stroke') markPaintInput()
          onDown(point(event), event)
        }}
        onPointerMove={(event) => {
          const next = point(event)
          onHover(next)
          if (event.buttons && previewInputMode === 'stroke') markPaintInput()
          onMove(next, event)
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
      />
    </div>
  )
}
