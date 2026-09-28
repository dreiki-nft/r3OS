import { useMemo, useState } from 'react'
import { openProgram, visiblePrograms } from './programs'
import { playSound } from './sound'
import { Icon } from './ui/Icon'

export function desktopRows(height = typeof innerHeight === 'number' ? innerHeight : 900) {
  return Math.max(1, Math.floor((height - 48 - 16) / 88))
}

export function Desktop() {
  const programs = visiblePrograms()
  const [selected, setSelected] = useState(0)
  const rows = useMemo(() => desktopRows(), [])

  const open = (index: number) => openProgram(programs[index].id)
  const choose = (index: number) => {
    setSelected(index)
    playSound('select')
  }

  return (
    <div
      className="desktop-icons"
      role="grid"
      tabIndex={0}
      style={{ gridTemplateRows: `repeat(${rows}, 88px)` }}
      onKeyDown={(event) => {
        let next = selected
        if (event.key === 'ArrowDown') next = Math.min(programs.length - 1, selected + 1)
        if (event.key === 'ArrowUp') next = Math.max(0, selected - 1)
        if (event.key === 'ArrowRight') next = Math.min(programs.length - 1, selected + rows)
        if (event.key === 'ArrowLeft') next = Math.max(0, selected - rows)
        if (event.key === 'Enter') open(selected)
        if (next !== selected) choose(next)
      }}
    >
      {programs.map((program, index) => (
        <button
          role="gridcell"
          key={program.id}
          className={`desktop-icon ${selected === index ? 'selected' : ''}`}
          onClick={() => {
            choose(index)
            if (matchMedia('(max-width:640px)').matches) open(index)
          }}
          onDoubleClick={() => open(index)}
        >
          <Icon name={program.icon} size={36} colour={program.colour} />
          <span className="desktop-icon-label">{program.title}</span>
        </button>
      ))}
    </div>
  )
}
