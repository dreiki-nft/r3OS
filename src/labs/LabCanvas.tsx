import { useEffect, useRef, type PointerEvent } from 'react'
import { PALETTE } from '../lib/palette'

export function LabCanvas({
  size,
  pixels,
  zoom,
  onPixel,
  previewCells,
  overlay,
  ghost,
  ghostOpacity = 0.3,
}: {
  size: 32 | 64 | 256
  pixels: Uint8Array
  zoom: number
  onPixel?: (x: number, y: number, event: PointerEvent<HTMLCanvasElement>) => void
  previewCells?: readonly { x: number; y: number }[]
  overlay?: Uint8Array
  ghost?: Uint8Array
  ghostOpacity?: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const image = context.createImageData(size, size)
    for (let i = 0; i < size * size; i++) {
      const entry = PALETTE[pixels[i] ?? 0]
      const offset = i * 4
      const ghostEntry = ghost ? PALETTE[ghost[i] ?? 0] : undefined
      const opacity = Math.max(0, Math.min(1, ghostOpacity))
      image.data[offset] = ghostEntry
        ? Math.round(entry.rgb[0] * (1 - opacity) + ghostEntry.rgb[0] * opacity)
        : entry.rgb[0]
      image.data[offset + 1] = ghostEntry
        ? Math.round(entry.rgb[1] * (1 - opacity) + ghostEntry.rgb[1] * opacity)
        : entry.rgb[1]
      image.data[offset + 2] = ghostEntry
        ? Math.round(entry.rgb[2] * (1 - opacity) + ghostEntry.rgb[2] * opacity)
        : entry.rgb[2]
      image.data[offset + 3] = 255
      if (overlay?.[i]) {
        const weed = PALETTE[8].rgb
        image.data[offset] = weed[0]
        image.data[offset + 1] = weed[1]
        image.data[offset + 2] = weed[2]
      }
    }
    context.putImageData(image, 0, 0)
    if (previewCells?.length) {
      context.save()
      context.fillStyle = 'rgba(95,237,223,.55)'
      for (const cell of previewCells) context.fillRect(cell.x, cell.y, 1, 1)
      context.restore()
    }
    if (zoom >= 5 && size <= 64) {
      context.save()
      context.strokeStyle = 'rgba(0,0,0,.24)'
      context.lineWidth = 1 / zoom
      for (let n = 0; n <= size; n++) {
        context.beginPath()
        context.moveTo(n, 0)
        context.lineTo(n, size)
        context.stroke()
        context.beginPath()
        context.moveTo(0, n)
        context.lineTo(size, n)
        context.stroke()
      }
      context.restore()
    }
  }, [size, pixels, previewCells, overlay, ghost, ghostOpacity, zoom])

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(size - 1, Math.floor(((event.clientX - rect.left) * size) / rect.width))),
      y: Math.max(0, Math.min(size - 1, Math.floor(((event.clientY - rect.top) * size) / rect.height))),
    }
  }

  return (
    <canvas
      ref={ref}
      className="lab-canvas"
      width={size}
      height={size}
      style={{ width: size * zoom, height: size * zoom }}
      onPointerDown={(event) => {
        if (!onPixel) return
        event.currentTarget.setPointerCapture(event.pointerId)
        const p = point(event)
        onPixel(p.x, p.y, event)
      }}
      onPointerMove={(event) => {
        if (!onPixel || event.buttons === 0) return
        const p = point(event)
        onPixel(p.x, p.y, event)
      }}
    />
  )
}
