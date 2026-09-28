import { useState, type CSSProperties } from 'react'
import { Icon } from './Icon'
export function SafeImage({
  src,
  alt,
  width,
  height,
  className,
  style,
}: {
  src: string
  alt: string
  width: number
  height: number
  className?: string
  style?: CSSProperties
}) {
  const [bad, setBad] = useState(false)
  if (bad || !src)
    return (
      <span
        className={className}
        style={{ display: 'inline-grid', placeItems: 'center', width, height, ...style }}
      >
        <Icon name="frog" size={width >= 60 ? 72 : width >= 32 ? 36 : 24} />
      </span>
    )
  return (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      style={style}
      onError={() => setBad(true)}
    />
  )
}
