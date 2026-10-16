import { createPublicClient, formatEther, http, parseAbi } from 'viem'

const RAFFLE = '0x478844840df2096Ca08AF5ce8a5CdC632493228f'
const ENTROPY = '0xD458261E832415CFd3BAE5E416FdF3230ce6F134'
const PROVIDER = '0x52DeaA1c84233F7bb8C8A45baeDE41091c616506'
const STATES = ['Pending', 'LoadingSnapshot', 'SnapshotLoaded', 'PrizeDeposited', 'DrawRequested', 'RandomnessReceived', 'Complete']
const NEXT = {
  Pending: 'initSnapshot(snapshotBlock, snapshotHash)',
  LoadingSnapshot: 'loadTicketsBatch(wallets, tickets), then finalizeSnapshot()',
  SnapshotLoaded: 'send the prize NFT to the raffle with safeTransferFrom from a team wallet',
  PrizeDeposited: 'setDrawDeadline(block), then requestDraw(randomBytes32) with the fee as value',
  DrawRequested: 'wait for the Pyth callback (a few blocks)',
  RandomnessReceived: 'fulfillDraw() (anyone can call it)',
  Complete: 'claimPrize() if the prize is still in the contract; reset() to start a new raffle once it is claimed',
}
const abi = parseAbi([
  'function owner() view returns (address)',
  'function getRaffleState() view returns (uint8, uint64, bytes32, address, uint256, bool, bool)',
  'function getRaffleInfo() view returns (uint256, uint256, uint256, bytes32, address, uint256, address, uint256)',
])
const entropyAbi = parseAbi(['function getFee(address provider) view returns (uint128)'])
const client = createPublicClient({ transport: http('https://rpc.monad.xyz', { retryCount: 3 }) })
const read = (functionName) => client.readContract({ address: RAFFLE, abi, functionName })

try {
  const [owner, state, info, head] = await Promise.all([read('owner'), read('getRaffleState'), read('getRaffleInfo'), client.getBlockNumber()])
  const fee = await client.readContract({ address: ENTROPY, abi: entropyAbi, functionName: 'getFee', args: [PROVIDER] }).catch(() => undefined)
  const name = STATES[Number(state[0])] ?? `unknown (${state[0]})`
  console.log(`state           ${name}`)
  console.log(`next step       ${NEXT[name] ?? '?'}`)
  console.log(`owner           ${owner}`)
  console.log(`wallets/tickets ${info[1]} wallets · ${info[0]} tickets`)
  console.log(`snapshot        block ${info[2]} · hash ${info[3]}`)
  console.log(`prize           ${state[5] ? `${info[4]} #${info[5]} (from ${info[6]})` : 'none deposited'}${state[6] ? ' · claimed' : ''}`)
  console.log(`draw deadline   ${info[7] === 0n ? 'not set' : `block ${info[7]}`} · chain head ${head}`)
  console.log(`winner          ${state[3] === '0x0000000000000000000000000000000000000000' ? 'none yet' : `${state[3]} (ticket ${state[4]})`}`)
  console.log(`pyth fee now    ${fee == null ? "couldn't read it" : `${formatEther(fee)} MON`}`)
} catch (error) {
  console.error(`raffle-status failed: ${String(error?.shortMessage ?? error?.message ?? error).replace(/https?:\/\/\S+/g, '[rpc]')}`)
  process.exit(1)
}
