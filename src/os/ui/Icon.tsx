import type { CSSProperties } from 'react'
import type { IconName } from '../icons'
export function Icon({
  name,
  size = 24,
  colour,
  title,
}: {
  name: IconName
  size?: 20 | 24 | 36 | 72
  colour?: string
  title?: string
}) {
  const file = size > 36 ? `${name}@2x.png` : `${name}.png`
  return (
    <span
      role={title ? 'img' : undefined}
      aria-label={title}
      className="ico"
      style={
        {
          width: size,
          height: size,
          '--ico': `url(/os/icons/${file})`,
          '--ico-colour': colour,
        } as CSSProperties
      }
    />
  )
}
