export const ACCEPTANCE_GATES_SCHEMA = 'r3os-local-acceptance/v1'
export const REQUIRED_LOCAL_GATES = Object.freeze([
  'speculation',
  'torture',
  'repoDoctor',
  'web',
  'generated',
  'build',
  'contractsBuild',
  'contractsTest',
  'diffCheck',
])

export function resolveToolInvocation(tool, args, runtime = {}) {
  const platform = runtime.platform ?? process.platform
  const env = runtime.env ?? process.env
  const execPath = runtime.execPath ?? process.execPath

  if (tool === 'npm') {
    // npm exposes the exact CLI entrypoint while running an npm script. Invoking
    // that JavaScript file through the current Node executable avoids Windows'
    // special .cmd spawning rules entirely.
    const npmExecPath = env.npm_execpath
    if (npmExecPath) {
      return {
        command: execPath,
        args: [npmExecPath, ...args],
        display: `npm ${args.join(' ')}`,
      }
    }

    // Direct `node scripts/acceptance-gates.mjs` fallback. On Windows npm is a
    // .cmd shim, so execute it through cmd.exe rather than spawnSync(shell:false).
    if (platform === 'win32') {
      const comspec = env.ComSpec || env.COMSPEC || 'cmd.exe'
      return {
        command: comspec,
        args: ['/d', '/s', '/c', `npm ${args.join(' ')}`],
        display: `npm ${args.join(' ')}`,
      }
    }

    return { command: 'npm', args, display: `npm ${args.join(' ')}` }
  }

  if (tool === 'git') return { command: 'git', args, display: `git ${args.join(' ')}` }
  return { command: tool, args, display: `${tool} ${args.join(' ')}` }
}

export function validateAcceptanceGates(input) {
  const errors = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['acceptance gates must be an object']
  if (input.schema !== ACCEPTANCE_GATES_SCHEMA) errors.push(`acceptance gates schema must be ${ACCEPTANCE_GATES_SCHEMA}`)
  if (!input.gates || typeof input.gates !== 'object') return [...errors, 'acceptance gates.gates is required']
  for (const name of REQUIRED_LOCAL_GATES) {
    const gate = input.gates[name]
    if (!gate || typeof gate !== 'object') errors.push(`acceptance gate ${name} is required`)
    else if (gate.exitCode !== 0) errors.push(`acceptance gate ${name} must have exitCode 0`)
  }
  if (input.allGreen !== true) errors.push('acceptance gates allGreen must be true')
  return errors
}
