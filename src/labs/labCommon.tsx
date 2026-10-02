import { bytesToHex, hexToBytes, type Address, type Hex } from 'viem'
import { discoverContracts } from '../chain/contracts'
import { PALETTE } from '../lib/palette'
import { playSound } from '../os/sound'

/** The registry answered and this program is not in it. Anything else (RPC down, timeout) is "offline". */
export class LabNotDeployedError extends Error {
  constructor() {
    super("this program isn't installed on this network")
  }
}

export const LAB_OFFLINE_TEXT = "can't reach Monad right now. check your connection and try again."

/** User-facing text for a failed `labAddress`: never claims "not deployed" when the network is just down. */
export const labLoadError = (error: unknown) =>
  error instanceof LabNotDeployedError ? error.message : LAB_OFFLINE_TEXT

export async function labAddress(name: string) {
  const address = (await discoverContracts()).labs[name]
  if (!address) throw new LabNotDeployedError()
  return address
}

export function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—'
}

export function hexBytes(value: Hex | Uint8Array) {
  return value instanceof Uint8Array ? value : hexToBytes(value)
}

export function asHex(bytes: Uint8Array): Hex {
  return bytesToHex(bytes)
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function colourButtons(selected: number, onSelect: (index: number) => void) {
  return PALETTE.map((entry) => (
    <button
      key={entry.index}
      className={selected === entry.index ? 'selected' : ''}
      title={entry.name}
      style={{ background: entry.hex }}
      onClick={() => {
        onSelect(entry.index)
        playSound('select')
      }}
    />
  ))
}

export function sameAddress(a?: Address | null, b?: Address | null) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase())
}
