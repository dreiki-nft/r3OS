import { PALETTE } from '../lib/palette'
import { playSound } from '../os/sound'

export function PaletteBar({
  foreground,
  backgroundIndex,
  onForeground,
  onBackground,
  seasonBackground,
}: {
  foreground: number
  backgroundIndex: number
  onForeground: (index: number) => void
  onBackground: (index: number) => void
  seasonBackground: number
}) {
  return (
    <div className="palette-row">
      <div className="colour-well sunken">
        <i style={{ background: PALETTE[backgroundIndex].hex }} />
        <b
          style={{ background: foreground === 0 ? PALETTE[seasonBackground].hex : PALETTE[foreground].hex }}
        />
      </div>
      <div className="palette-grid">
        {PALETTE.map((entry) => (
          <button
            key={entry.index}
            title={`${entry.index}: ${entry.name}`}
            aria-label={entry.name}
            className={foreground === entry.index ? 'selected' : ''}
            style={{
              background:
                entry.index === 0
                  ? `repeating-linear-gradient(45deg, ${PALETTE[seasonBackground].hex} 0 5px, #555 5px 6px)`
                  : entry.hex,
            }}
            onClick={() => {
              onForeground(entry.index)
              playSound('select')
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              onBackground(entry.index)
              playSound('select')
            }}
          />
        ))}
      </div>
    </div>
  )
}
