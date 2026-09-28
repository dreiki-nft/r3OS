import { useEffect, useRef } from 'react'
import type { PixelImage } from './frameImage'

export function PixelPreview({
  image,
  size,
  className = '',
}: {
  image?: PixelImage
  size: number
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !image) return
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) return
    const data = context.createImageData(image.width, image.height)
    data.data.set(image.rgba)
    context.putImageData(data, 0, 0)
  }, [image])
  return (
    <canvas
      ref={ref}
      className={`pixel-preview ${className}`}
      width={image?.width ?? 256}
      height={image?.height ?? 256}
      style={{ width: size, height: size }}
    />
  )
}
