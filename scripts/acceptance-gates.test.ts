import { describe, expect, it } from 'vitest'
import {
  ACCEPTANCE_GATES_SCHEMA,
  REQUIRED_LOCAL_GATES,
  resolveToolInvocation,
  validateAcceptanceGates,
} from './acceptance-gates-lib.mjs'

const green = () => ({
  schema: ACCEPTANCE_GATES_SCHEMA,
  allGreen: true,
  gates: Object.fromEntries(REQUIRED_LOCAL_GATES.map((name) => [name, { command: name, exitCode: 0 }])),
})

describe('local acceptance gate evidence', () => {
  it('requires every launch-relevant local gate to be green', () => {
    expect(validateAcceptanceGates(green())).toEqual([])
    const bad = green()
    bad.gates.torture.exitCode = 1
    expect(validateAcceptanceGates(bad)).toContain('acceptance gate torture must have exitCode 0')
  })

  it('runs npm through the current Node executable when npm exposes its CLI entrypoint', () => {
    expect(
      resolveToolInvocation('npm', ['run', 'test:web'], {
        platform: 'win32',
        execPath: 'C:\\Program Files\\nodejs\\node.exe',
        env: { npm_execpath: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js' },
      }),
    ).toEqual({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js', 'run', 'test:web'],
      display: 'npm run test:web',
    })
  })

  it('falls back to cmd.exe for npm when launched directly on Windows', () => {
    expect(
      resolveToolInvocation('npm', ['run', 'build'], {
        platform: 'win32',
        execPath: 'C:\\Program Files\\nodejs\\node.exe',
        env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
      }),
    ).toEqual({
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'npm run build'],
      display: 'npm run build',
    })
  })
})
