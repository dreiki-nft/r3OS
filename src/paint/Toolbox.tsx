import { playSound } from '../os/sound'
import type { IconName } from '../os/icons'
import { Icon } from '../os/ui/Icon'

export type Tool = 'pencil' | 'brush' | 'fill' | 'picker' | 'line' | 'rect' | 'ellipse' | 'eraser' | 'zoom'
type Shape = 'line' | 'rect' | 'ellipse'

type ToolEntry = {
  id: Tool | 'dna'
  label: string
  icon?: IconName
  shape?: Shape
  disabled?: boolean
}

function ShapeIcon({ shape }: { shape: Shape }) {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
      {shape === 'line' && <path d="M3 13L13 3" fill="none" stroke="currentColor" strokeWidth="1.6" />}
      {shape === 'rect' && (
        <rect x="3" y="4" width="10" height="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
      )}
      {shape === 'ellipse' && (
        <ellipse cx="8" cy="8" rx="5" ry="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      )}
    </svg>
  )
}

const tools: ToolEntry[] = [
  { id: 'pencil', label: 'Pencil', icon: 'pencil' },
  { id: 'brush', label: 'Brush', icon: 'brush' },
  { id: 'fill', label: 'Fill', icon: 'bucket' },
  { id: 'picker', label: 'Picker', icon: 'picker' },
  { id: 'line', label: 'Line', shape: 'line' },
  { id: 'rect', label: 'Rectangle', shape: 'rect' },
  { id: 'ellipse', label: 'Ellipse', shape: 'ellipse' },
  { id: 'eraser', label: 'Eraser', icon: 'eraser' },
  { id: 'zoom', label: 'Zoom', icon: 'zoom' },
  { id: 'dna', label: 'Block DNA stamp', icon: 'dna', disabled: true },
]

export function Toolbox({
  tool,
  onTool,
  size,
  onSize,
}: {
  tool: Tool
  onTool: (tool: Tool) => void
  size: number
  onSize: (size: number) => void
}) {
  return (
    <aside className="toolbox">
      {tools.map((entry) => (
        <button
          key={entry.id}
          className={`tool raised ${tool === entry.id ? 'chosen' : ''}`}
          title={entry.disabled ? 'arrives with the Block DNA program' : entry.label}
          aria-label={entry.label}
          disabled={entry.disabled}
          onClick={() => {
            if (entry.id === 'dna') return
            playSound('select')
            onTool(entry.id)
          }}
        >
          {entry.icon ? (
            <Icon name={entry.icon} size={24} colour={entry.id === 'dna' ? '#C864AA' : undefined} />
          ) : (
            <ShapeIcon shape={entry.shape!} />
          )}
        </button>
      ))}
      <div className="tool-options sunken" aria-label="Brush size">
        {[1, 3, 5].map((value, index) => (
          <button
            key={value}
            aria-label={`Brush size ${value}`}
            className={size === value ? 'chosen' : ''}
            onClick={() => onSize(value)}
          >
            <span className={`brush-size-sample sample-${index + 1}`} />
          </button>
        ))}
      </div>
    </aside>
  )
}
