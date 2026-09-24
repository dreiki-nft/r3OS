import fs from 'node:fs'
import path from 'node:path'
import solc from 'solc'

const root = path.resolve(process.cwd())
const contractPath = path.join(root, 'contracts/src/R3tardsPaint.sol')
const source = fs.readFileSync(contractPath, 'utf8')

function findImports(importPath) {
  const candidates = [
    path.join(root, 'node_modules', importPath),
    path.join(root, 'contracts', importPath),
    path.join(root, importPath),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { contents: fs.readFileSync(candidate, 'utf8') }
    }
  }

  return { error: `Import not found: ${importPath}` }
}

const input = {
  language: 'Solidity',
  sources: {
    'contracts/src/R3tardsPaint.sol': { content: source },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'prague',
    outputSelection: {
      '*': {
        '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'],
      },
    },
  },
}

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }))
const errors = output.errors ?? []
for (const item of errors) {
  const stream = item.severity === 'error' ? process.stderr : process.stdout
  stream.write(`${item.formattedMessage}\n`)
}

if (errors.some((item) => item.severity === 'error')) {
  process.exit(1)
}

const compiled = output.contracts['contracts/src/R3tardsPaint.sol'].R3tardsPaint
const runtimeBytes = compiled.evm.deployedBytecode.object.length / 2
const initBytes = compiled.evm.bytecode.object.length / 2

fs.mkdirSync(path.join(root, 'contracts/out-solc'), { recursive: true })
fs.writeFileSync(
  path.join(root, 'contracts/out-solc/R3tardsPaint.json'),
  JSON.stringify({
    abi: compiled.abi,
    bytecode: `0x${compiled.evm.bytecode.object}`,
    deployedBytecode: `0x${compiled.evm.deployedBytecode.object}`,
  }, null, 2),
)

console.log(`R3tardsPaint compiled successfully.`)
console.log(`Init bytecode:    ${initBytes.toLocaleString()} bytes`)
console.log(`Runtime bytecode: ${runtimeBytes.toLocaleString()} bytes`)
console.log(`Monad max contract size target: 131,072 bytes (128 KiB)`)
