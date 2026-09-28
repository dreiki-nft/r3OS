import { useEffect, useRef, type PointerEvent } from 'react'
import { PALETTE } from '../lib/palette'
import type { Point } from '../lib/paintEngine'
import type { TilePreviewState } from './cost'

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
  onDown,
  onMove,
  onUp,
  onHover,
}: CanvasViewProps) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

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
  }, [pixels, outline, face, background, grid, protectedView, zoom, showHeat, tileStates, maxHeat, selection])

  const point = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(255, Math.floor(((event.clientX - rect.left) * 256) / rect.width))),
      y: Math.max(0, Math.min(255, Math.floor(((event.clientY - rect.top) * 256) / rect.height))),
    }
  }

  const finish = (event: PointerEvent<HTMLCanvasElement>) => onUp(point(event), event)

  return (
    <div
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
          onDown(point(event), event)
        }}
        onPointerMove={(event) => {
          const next = point(event)
          onHover(next)
          onMove(next, event)
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
      />
    </div>
  )
}
