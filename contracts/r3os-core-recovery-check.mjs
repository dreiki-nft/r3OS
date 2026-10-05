import fs from 'node:fs'
import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
} from 'viem'

const RPC = process.env.RPC_URL || 'https://rpc.monad.xyz'
const DEPLOYER = '0x40Ea55E0b8f02f8eBc9D91e082e202ed988647fA'
const PAINT = '0x5102DE3817aE16b3afaEb9D180130669A70787b3'
const LABS = '0xe6b3b17e3B1827FE02183F496e84331EBE74751C'
const DIFF = '0x5D2Dcd25D5E847770F6e8a7BFBDF1Df4F6E454F7'
const TIMELAPSE = '0x8C91D7A829569Ebf1DFC671F6cf328911813b78d'
const DF1 = '0x6eC2027e5B2493f2ECc5882BecE14B31197C3ce0'
const PASS = '0xb2D2D7681F451D9C69eD5eF2A0ed0B6b6494F103'
const AUCTION = '0x3D3154dB1B32724a82Ac9eC3f1811808558b9EF8'
const QUESTS = '0x4398f022d7700cf5541Ac59D2Ff83f1A8a30a6f1'
const RECYCLE = '0x02234e30daC8Bed319F30FB1Ec123da8bf71A2eb'
const CDBURNER = '0x5556B0ef2ffA3a970C852362EE69313C08f5B1cd'
const DELEGATOR = '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b'
const MODE_BATCH = `0x01${'00'.repeat(31)}`

function die(msg) {
  console.error(`STOP: ${msg}`)
  process.exit(1)
}

let rpcId = 0
async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  })
  const j = await res.json()
  if (j.error) throw new Error(`${method}: ${j.error.code} ${j.error.message}`)
  return j.result
}

async function rpcTry(method, params) {
  try {
    return { ok: true, result: await rpc(method, params) }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

const artifactPath = './broadcast/Deploy.s.sol/143/run-latest.json'
if (!fs.existsSync(artifactPath)) die(`missing ${artifactPath}`)
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'))
const txs = artifact.transactions?.map((x) => x.transaction)
if (!Array.isArray(txs) || txs.length !== 29) die(`expected 29 artifact transactions, found ${txs?.length}`)

const tx7 = txs[6]
const tx8 = txs[7]
const tx9 = txs[8]
const tx10 = txs[9]
if (BigInt(tx7.nonce) !== 181n || BigInt(tx8.nonce) !== 182n || BigInt(tx9.nonce) !== 183n || BigInt(tx10.nonce) !== 184n) {
  die('artifact nonce sequence 181..184 does not match reviewed plan')
}

const paintAbi = parseAbi([
  'function owner() view returns (address)',
  'function painterPass() view returns (address)',
  'function rendererCount() view returns (uint256)',
  'function setPainterPass(address pass)',
  'function addRenderer(address renderer,string name) returns (uint256)',
])
const delegatorAbi = parseAbi([
  'function supportsExecutionMode(bytes32 mode) view returns (bool)',
  'function execute(bytes32 mode,bytes executionCalldata) payable',
])

const expected7 = encodeFunctionData({ abi: paintAbi, functionName: 'setPainterPass', args: [PASS] })
const expected8 = encodeFunctionData({ abi: paintAbi, functionName: 'addRenderer', args: [DIFF, 'diff'] })
const expected9 = encodeFunctionData({ abi: paintAbi, functionName: 'addRenderer', args: [TIMELAPSE, 'season timelapse'] })
const expected10 = encodeFunctionData({ abi: paintAbi, functionName: 'addRenderer', args: [DF1, 'df1'] })
for (const [label, actual, expected] of [
  ['tx7 setPainterPass', tx7.input, expected7],
  ['tx8 addRenderer(diff)', tx8.input, expected8],
  ['tx9 addRenderer(timelapse)', tx9.input, expected9],
  ['tx10 addRenderer(df1)', tx10.input, expected10],
]) {
  if (actual?.toLowerCase() !== expected.toLowerCase()) die(`${label} calldata mismatch`)
}

const executionCalldata = encodeAbiParameters(
  [{
    type: 'tuple[]',
    components: [
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'callData', type: 'bytes' },
    ],
  }],
  [[
    { target: PAINT, value: 0n, callData: tx7.input },
    { target: PAINT, value: 0n, callData: tx8.input },
  ]],
)
const batchData = encodeFunctionData({
  abi: delegatorAbi,
  functionName: 'execute',
  args: [MODE_BATCH, executionCalldata],
})

const callView = async (fn, args = []) => {
  const data = encodeFunctionData({ abi: paintAbi, functionName: fn, args })
  const result = await rpc('eth_call', [{ to: PAINT, data }, 'latest'])
  return decodeFunctionResult({ abi: paintAbi, functionName: fn, data: result })
}

const chainId = BigInt(await rpc('eth_chainId', []))
if (chainId !== 143n) die(`wrong chain ${chainId}`)
const latestNonce = BigInt(await rpc('eth_getTransactionCount', [DEPLOYER, 'latest']))
const pendingNonce = BigInt(await rpc('eth_getTransactionCount', [DEPLOYER, 'pending']))
if (latestNonce !== 182n || pendingNonce !== 182n) die(`nonce is ${latestNonce}/${pendingNonce}, expected 182/182`)

const deployerCode = await rpc('eth_getCode', [DEPLOYER, 'latest'])
const expectedDelegation = `0xef0100${DELEGATOR.slice(2).toLowerCase()}`
if (deployerCode.toLowerCase() !== expectedDelegation) die(`deployer delegation designator changed: ${deployerCode}`)

for (const [name, addr] of [
  ['Paint', PAINT], ['Labs', LABS], ['Diff', DIFF], ['Timelapse', TIMELAPSE], ['DF1', DF1], ['Pass', PASS],
]) {
  const code = await rpc('eth_getCode', [addr, 'latest'])
  if (code === '0x') die(`${name} code is missing at ${addr}`)
}
for (const [name, addr] of [
  ['Auction', AUCTION], ['Quests', QUESTS], ['RecycleBin', RECYCLE], ['CDBurner', CDBURNER],
]) {
  const code = await rpc('eth_getCode', [addr, 'latest'])
  if (code !== '0x') die(`${name} predicted address is no longer empty: ${addr}`)
}

const owner = await callView('owner')
const painterPass = await callView('painterPass')
const rendererCount = await callView('rendererCount')
if (owner.toLowerCase() !== DEPLOYER.toLowerCase()) die(`Paint owner changed: ${owner}`)
if (painterPass !== '0x0000000000000000000000000000000000000000') die(`painterPass already set: ${painterPass}`)
if (rendererCount !== 1n) die(`rendererCount is ${rendererCount}, expected 1`)

const supportsData = encodeFunctionData({ abi: delegatorAbi, functionName: 'supportsExecutionMode', args: [MODE_BATCH] })
const supportsRaw = await rpc('eth_call', [{ from: DEPLOYER, to: DEPLOYER, data: supportsData }, 'latest'])
const supportsBatch = decodeFunctionResult({ abi: delegatorAbi, functionName: 'supportsExecutionMode', data: supportsRaw })
if (!supportsBatch) die('deployer delegation does not report simple batch mode support')

const lowGas = await rpcTry('eth_call', [{ from: DEPLOYER, to: PAINT, data: tx7.input, gas: tx7.gas }, 'latest'])
const tx7Estimate = BigInt(await rpc('eth_estimateGas', [{ from: DEPLOYER, to: PAINT, data: tx7.input }]))
const batchSimulation = await rpcTry('eth_call', [{ from: DEPLOYER, to: DEPLOYER, data: batchData, gas: '0x7a120' }, 'latest'])
if (!batchSimulation.ok) die(`2-call recovery batch simulation reverted: ${batchSimulation.error}`)
const batchEstimate = BigInt(await rpc('eth_estimateGas', [{ from: DEPLOYER, to: DEPLOYER, data: batchData }]))
const tx9Estimate = BigInt(await rpc('eth_estimateGas', [{ from: DEPLOYER, to: PAINT, data: tx9.input }]))
const tx10Estimate = BigInt(await rpc('eth_estimateGas', [{ from: DEPLOYER, to: PAINT, data: tx10.input }]))

console.log('RECOVERY CHECK PASSED — READ ONLY')
console.log(`chain:                 ${chainId}`)
console.log(`nonce latest/pending:  ${latestNonce}/${pendingNonce}`)
console.log(`deployer delegation:   ${DELEGATOR}`)
console.log(`batch mode supported:  ${supportsBatch}`)
console.log(`Paint owner:           ${owner}`)
console.log(`painterPass:           ${painterPass}`)
console.log(`rendererCount:         ${rendererCount}`)
console.log(`tx7 artifact gas:      ${BigInt(tx7.gas)}`)
console.log(`tx7 live estimate:     ${tx7Estimate}`)
console.log(`tx7 @ artifact gas:    ${lowGas.ok ? 'SUCCEEDED (unexpected; investigate)' : `FAILED as expected (${lowGas.error})`}`)
console.log(`recovery batch estimate: ${batchEstimate}`)
console.log(`tx9 live estimate:     ${tx9Estimate}`)
console.log(`tx10 live estimate:    ${tx10Estimate}`)
console.log(`recovery batch hash:   ${keccak256(batchData)}`)
console.log('recovery batch eth_call: PASS')
console.log('No transaction was signed or sent.')
