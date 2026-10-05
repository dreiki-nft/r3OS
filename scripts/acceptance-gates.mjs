#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { ACCEPTANCE_GATES_SCHEMA, resolveToolInvocation } from './acceptance-gates-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checks = [
  ['speculation', 'npm', ['run', 'test:speculation']],
  ['torture', 'npm', ['run', 'test:torture']],
  ['repoDoctor', 'npm', ['run', 'repo:doctor']],
  ['web', 'npm', ['run', 'test:web']],
  ['generated', 'npm', ['run', 'generated:check']],
  ['build', 'npm', ['run', 'build']],
  ['contractsBuild', 'npm', ['run', 'contracts:build']],
  ['contractsTest', 'npm', ['run', 'contracts:test']],
  ['diffCheck', 'git', ['diff', '--check']],
]

const startedAt = new Date().toISOString()
const gates = {}
for (const [name, tool, args] of checks) {
  const invocation = resolveToolInvocation(tool, args)
  console.log(`\n=== ${name}: ${invocation.display} ===`)
  const start = Date.now()
  const result = spawnSync(invocation.command, invocation.args, { cwd: root, stdio: 'inherit', shell: false })
  const spawnError = result.error ? `${result.error.name}: ${result.error.message}` : null
  const exitCode = typeof result.status === 'number' ? result.status : 1
  const durationMs = Date.now() - start

  gates[name] = {
    command: invocation.display,
    exitCode,
    durationMs,
    ...(spawnError ? { spawnError } : {}),
  }

  if (spawnError) console.error(`gate ${name}: failed to start command (${spawnError})`)
  else if (exitCode !== 0) console.error(`gate ${name}: FAILED with exit code ${exitCode}`)
  else console.log(`gate ${name}: PASS (${durationMs} ms)`)
}

const allGreen = Object.values(gates).every((gate) => gate.exitCode === 0)
const artifact = {
  schema: ACCEPTANCE_GATES_SCHEMA,
  startedAt,
  completedAt: new Date().toISOString(),
  allGreen,
  gates,
}
const outDir = resolve(root, 'artifacts')
mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'local-acceptance-gates.json'), `${JSON.stringify(artifact, null, 2)}\n`)
console.log(`\nlocal acceptance gates: ${allGreen ? 'GREEN' : 'FAILED'}`)
console.log('wrote artifacts/local-acceptance-gates.json')
process.exit(allGreen ? 0 : 1)
