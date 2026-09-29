import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { openProgram, visiblePrograms } from './programs'
import { playSound } from './sound'
import { Icon } from './ui/Icon'
import { publicClient, wsClient } from '../chain/clients'
import { discoverContracts } from '../chain/contracts'
import { R3TARDS_RECYCLE_BIN_ABI } from '../lib/generated/abi'
import { getReleaseSnapshot, programNeedsSparkle, subscribeReleases } from './releases'

export function desktopRows(height = typeof innerHeight === 'number' ? innerHeight : 900) {
  return Math.max(1, Math.floor((height - 48 - 16) / 88))
}

export function Desktop() {
  const releases = useSyncExternalStore(subscribeReleases, getReleaseSnapshot)
  const programs = visiblePrograms(releases)
  const [selected, setSelected] = useState(0)
  const rows = useMemo(() => desktopRows(), [])
  const [binFull, setBinFull] = useState(false)

  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false
    const client = publicClient
    void (async () => {
      if (!client) return
      const bin = (await discoverContracts()).labs['recycle-bin']
      if (!bin) return
      const read = async () => {
        const total = BigInt(
          await client.readContract({
            address: bin,
            abi: R3TARDS_RECYCLE_BIN_ABI,
            functionName: 'totalBurned',
          }),
        )
        if (!cancelled) setBinFull(total > 0n)
      }
      await read()
      if (wsClient) {
        stop = wsClient.watchContractEvent({
          address: bin,
          abi: R3TARDS_RECYCLE_BIN_ABI,
          eventName: 'Recycled',
          onLogs: () => void read(),
        })
      }
    })().catch(() => undefined)
    return () => {
      cancelled = true
      stop?.()
    }
  }, [])

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
          className={`desktop-icon ${selected === index ? 'selected' : ''} ${program.id === 'bin' && binFull ? 'desktop-bin-full' : ''} ${programNeedsSparkle(program.id, releases) ? 'desktop-icon-new' : ''}`}
          onDragOver={(event) => {
            if (program.id === 'bin' && event.dataTransfer.types.includes('application/x-r3-frame'))
              event.preventDefault()
          }}
          onDrop={(event) => {
            if (program.id !== 'bin') return
            const id = Number(event.dataTransfer.getData('application/x-r3-frame'))
            if (id > 0) {
              event.preventDefault()
              openProgram('bin', true, `#/bin?recycle=${id}`)
            }
          }}
          onClick={() => {
            choose(index)
            if (matchMedia('(max-width:640px)').matches) open(index)
          }}
          onDoubleClick={() => open(index)}
        >
          <span className="desktop-icon-art">
            <Icon name={program.icon} size={36} colour={program.colour} />
            {program.id === 'bin' && binFull && <i className="desktop-bin-paper" aria-label="full" />}
          </span>
          <span className="desktop-icon-label">{program.title}</span>
        </button>
      ))}
    </div>
  )
}
