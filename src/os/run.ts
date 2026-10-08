/**
 * Start → Run… command parser. This is not a shell: the input is treated as hostile and matched against a
 * static allowlist. The result is a typed target whose hash is built here, never taken from the input.
 * Opening always goes through `openProgram`, so release gating applies exactly as it does everywhere else.
 */

export type RunTarget = { program: string; hash?: string }
export type RunParse = { ok: true; target: RunTarget } | { ok: false; error: string }

/** command (or alias) → active program id. Retired UI programs are absent from this allowlist entirely. */
export const RUN_COMMANDS: Readonly<Record<string, string>> = Object.freeze({
  demo: 'demo',
  paint: 'paint',
  pass: 'pass',
  frames: 'frames',
  auction: 'auction',
  quests: 'quests',
  cd: 'cd',
  cdrom: 'cdrom',
  replay: 'replay',
  timelapse: 'replay',
  validators: 'validators',
  network: 'validators',
  camera: 'block-camera',
  'block-camera': 'block-camera',
  explore: 'monad-hw',
  monad: 'monad-hw',
  hardware: 'monad-hw',
  'monad-hw': 'monad-hw',
  xray: 'xray',
  sounds: 'sounds',
  help: 'help',
  bin: 'bin',
  dxdiag: 'dxdiag',
})

const UINT256_MAX = (1n << 256n) - 1n
const MAX_INPUT = 90 // "card " + the 78 digits of uint256 max fits

export const RUN_EXAMPLES = 'demo.exe · paint · explore · camera'

function notFound(input: string): RunParse {
  const shown = input.length > 40 ? `${input.slice(0, 39)}…` : input
  return {
    ok: false,
    error: `Windows cannot find '${shown}'. Make sure you typed the name correctly, and then try again.`,
  }
}

function parseUint(text: string, max: bigint) {
  if (!/^[0-9]{1,78}$/.test(text)) return undefined
  const value = BigInt(text)
  return value <= max ? value : undefined
}

export function parseRunCommand(raw: string): RunParse {
  const input = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
  if (!input) return { ok: false, error: 'Type the name of a program to open.' }
  if (input.length > MAX_INPUT) return notFound(input)
  const normalized = input.toLowerCase().replace(/\s+/g, ' ')
  // Only letters, digits, spaces, hyphens and a trailing ".exe" are ever valid. Anything else (URLs,
  // "javascript:", paths, query strings, hashes) is rejected before lookup.
  if (!/^[a-z0-9 -]+(\.exe)?( [0-9]+)?$/.test(normalized)) return notFound(input)

  const [word, arg, ...rest] = normalized.split(' ')
  if (rest.length) return notFound(input)
  const command = word.endsWith('.exe') ? word.slice(0, -4) : word

  if (command === 'operator' && arg == null)
    return { ok: true, target: { program: 'pass', hash: '#/pass?tab=Operator' } }

  if (command === 'frame' && arg != null) {
    // Frame Properties reads the token with Number(), so stay inside the safe-integer range.
    const id = parseUint(arg, BigInt(Number.MAX_SAFE_INTEGER))
    if (id == null || id === 0n) return notFound(input)
    return { ok: true, target: { program: 'frame-props', hash: `#/frame-props?token=${id}` } }
  }

  if (command === 'auction' && arg != null) {
    // The Auction route already understands `?auction=<id>`.
    const id = parseUint(arg, UINT256_MAX)
    if (id == null || id === 0n) return notFound(input)
    return { ok: true, target: { program: 'auction', hash: `#/auction?auction=${id}` } }
  }

  if (arg != null) return notFound(input)
  const program = Object.prototype.hasOwnProperty.call(RUN_COMMANDS, command)
    ? RUN_COMMANDS[command]
    : undefined
  return program ? { ok: true, target: { program } } : notFound(input)
}
