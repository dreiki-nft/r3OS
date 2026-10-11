import { useEffect, useState, type CSSProperties } from 'react'
import { Icon } from './Icon'
export function SafeImage({
  src,
  alt,
  width,
  height,
  className,
  style,
  noReferrer = false,
  onFail,
}: {
  src: string
  alt: string
  width: number
  height: number
  className?: string
  style?: CSSProperties
  /** load without telling the image host which site it is on (some hosts refuse embeds by referrer) */
  noReferrer?: boolean
  /** called once when the image fails, so the caller can offer another source */
  onFail?: () => void
}) {
  const [bad, setBad] = useState(false)
  // A new source gets a fresh chance.
  useEffect(() => setBad(false), [src])
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
      referrerPolicy={noReferrer ? 'no-referrer' : undefined}
      onError={() => {
        setBad(true)
        onFail?.()
      }}
    />
  )
}
