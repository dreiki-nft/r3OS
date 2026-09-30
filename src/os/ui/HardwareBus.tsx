import { useSyncExternalStore } from 'react'
import { getBlockSnapshot, subscribeBlocks } from '../../chain/blocks'
import { useMonadCard } from '../../chain/monadCard'
import { useMonadHardware, type DeviceStatus } from '../../chain/monadHardware'
import { openProgram } from '../programs'

export type HardwareDevice = 'clock' | 'storage' | 'consensus' | 'execution' | 'rom' | 'card'
type BusStatus = DeviceStatus | 'idle'

const DEVICES: { id: HardwareDevice; label: string }[] = [
  { id: 'clock', label: 'CLOCK' },
  { id: 'storage', label: 'STORAGE' },
  { id: 'consensus', label: 'CONSENSUS' },
  { id: 'execution', label: 'EXECUTION' },
  { id: 'rom', label: 'ROM' },
  { id: 'card', label: 'CARD' },
]

function statusFor(
  id: HardwareDevice,
  hw: ReturnType<typeof useMonadHardware>,
  card: ReturnType<typeof useMonadCard>,
  clockMode: ReturnType<typeof getBlockSnapshot>['mode'],
): BusStatus {
  if (id === 'clock') return clockMode === 'offline' ? 'unknown' : 'present'
  if (id === 'storage') return hw.storage.status
  if (id === 'consensus') return hw.staking.status
  if (id === 'execution') return hw.reserve.status
  if (id === 'card') {
    if (card.status === 'present') return 'present'
    if (card.status === 'unknown-id' || (card.status === 'no-driver' && card.balance > 0n)) return 'unknown'
    return 'idle'
  }
  if (hw.rom.source !== 'measured') return 'unknown'
  return hw.rom.value.some((entry) => entry.bytes && entry.bytes > 0) ? 'present' : 'unknown'
}

export function HardwareBus({ highlight = [] }: { highlight?: readonly HardwareDevice[] }) {
  const hw = useMonadHardware()
  const card = useMonadCard()
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)

  return (
    <div className="hardware-bus" role="group" aria-label="Monad hardware bus">
      {DEVICES.map((device) => {
        const status = statusFor(device.id, hw, card, block.mode)
        return (
          <button
            key={device.id}
            className={highlight.includes(device.id) ? 'active' : ''}
            title={`${device.label}: ${status === 'idle' ? 'empty' : status}`}
            onClick={() => openProgram('monad-hw', true, `#/monad-hw/${device.id}`)}
          >
            <i className={`hardware-light ${status === 'idle' ? '' : status}`} />
            {device.label}
          </button>
        )
      })}
    </div>
  )
}
