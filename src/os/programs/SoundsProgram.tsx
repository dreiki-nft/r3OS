import { useState } from 'react'
import { Tabs } from '../ui/Tabs'
import { GroupBox } from '../ui/GroupBox'
import { ListBox } from '../ui/ListBox'
import { Button } from '../ui/Button'
import { getVolume, isMuted, playSound, setMuted, setVolume, type SoundName } from '../sound'
import { Icon } from '../ui/Icon'
const rows: [SoundName, string, string][] = [
  ['system-initiate', 'Wallet connected', 'system-initiate.mp3'],
  ['system-shutdown', 'Disconnect / Shut Down', 'system-shutdown.mp3'],
  ['select', 'Selection', 'select.mp3'],
  ['confirm', 'Transaction submitted', 'confirm.mp3'],
  ['cancel', 'Cancel / rejected', 'cancel.mp3'],
  ['success-light', 'Paint landed', 'success-light.mp3'],
  ['success-heavy', 'Frame / Pass', 'success-heavy.mp3'],
  ['error', 'Error', 'error.mp3'],
  ['storm', 'Storm starts', 'storm.mp3'],
  ['df1', 'DF1 corruption', 'df1.mp3'],
  ['cute-bubble', 'Balloon', 'cute-bubble.mp3'],
  ['text', 'Assistant tip', 'text.mp3'],
]
export function SoundsProgram() {
  const [selected, setSelected] = useState(rows[0])
  const [vol, setVol] = useState(Math.round(getVolume() * 100))
  const [muted, setM] = useState(isMuted())
  return (
    <div className="properties">
      <Tabs tabs={['Sounds']} active="Sounds" onChange={() => {}} />
      <ListBox label="Sound events">
        <div role="treeitem" className="list-root">
          r3tardOS
        </div>
        {rows.map((r) => (
          <button
            role="option"
            aria-selected={selected === r}
            key={r[0]}
            onClick={() => {
              setSelected(r)
              playSound(r[0])
            }}
          >
            <Icon name="speaker" size={20} />
            {r[1]} <small>{r[2]}</small>
          </button>
        ))}
      </ListBox>
      <GroupBox title="Sound">
        <label>
          Name
          <input readOnly value={`/os/sfx/${selected[2]}`} />
        </label>
        <Button onClick={() => playSound(selected[0])}>Preview ▶</Button>
        <label>
          Volume{' '}
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={vol}
            onChange={(e) => {
              const v = Number(e.target.value)
              setVol(v)
              setVolume(v / 100)
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={muted}
            onChange={(e) => {
              setM(e.target.checked)
              setMuted(e.target.checked)
            }}
          />{' '}
          Mute all sounds
        </label>
      </GroupBox>
      <div className="dialog-actions">
        <Button primary>OK</Button>
        <Button>Cancel</Button>
        <Button>Apply</Button>
      </div>
    </div>
  )
}
