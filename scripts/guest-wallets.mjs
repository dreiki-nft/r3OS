#!/usr/bin/env node
/**
 * Throwaway guest wallets for hackathon judges. Run on your own machine; nothing here touches your main wallet.
 *
 *   node scripts/guest-wallets.mjs create --count 5          # new keys → guest-wallets.local.json (gitignored)
 *   node scripts/guest-wallets.mjs status                     # balances, transactions sent, links
 *   node scripts/guest-wallets.mjs sweep --to 0xYourWallet     # after judging: send what's left back
 *
 * Fund each printed address yourself from your own wallet. Treat every guest key as public: put the links only
 * in the private part of the submission, never in the repo, README or social posts. Exclude these addresses
 * from community numbers: node scripts/community-stats.mjs --exclude-file guest-wallets.local.json
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, formatEther, http } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const FILE = 'guest-wallets.local.json'
const SITE = 'https://r3os.app'
const PAINT_GAS = 400_000n // the app's own conservative gas for one paint
const [command, ...argv] = process.argv.slice(2)
const flags = {}
for (let i = 0; i < argv.length; i += 2) flags[argv[i].replace(/^--/, '')] = argv[i + 1]
const rpc = flags.rpc ?? 'https://rpc.monad.xyz'
const client = createPublicClient({ transport: http(rpc, { retryCount: 3 }) })
const safe = (error) =>
  String(error?.shortMessage ?? error?.message ?? error).replace(/https?:\/\/\S+/g, '[rpc]')

function load() {
  if (!existsSync(FILE)) throw new Error(`${FILE} not found; run "create" first`)
  return JSON.parse(readFileSync(FILE, 'utf8'))
}

try {
  if (command === 'create') {
    if (existsSync(FILE))
      throw new Error(`${FILE} already exists; refusing to overwrite keys that may hold MON`)
    const count = Number(flags.count ?? 5)
    if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('--count must be 1-20')
    const wallets = Array.from({ length: count }, (_, i) => {
      const key = generatePrivateKey()
      return {
        name: `judge-${i + 1}`,
        address: privateKeyToAccount(key).address,
        key,
        link: `${SITE}/#/guest/${key.slice(2)}`,
      }
    })
    writeFileSync(FILE, JSON.stringify({ created: new Date().toISOString(), wallets }, null, 2), {
      mode: 0o600,
    })
    const gasPrice = await client.getGasPrice().catch(() => undefined)
    console.log(`wrote ${FILE} (keep it out of git; .gitignore already covers it)\n`)
    if (gasPrice) {
      const perPaint = PAINT_GAS * gasPrice
      console.log(
        `one paint costs up to ~${formatEther(perPaint)} MON right now (Monad charges the gas limit).`,
      )
      console.log(`for ~30 paints per judge, send ~${formatEther(perPaint * 30n)} MON to each address:\n`)
    }
    for (const wallet of wallets) console.log(`${wallet.name}  ${wallet.address}`)
    console.log('\nthe private links are in the file; run "status" after funding to see them with balances.')
  } else if (command === 'status') {
    const { wallets } = load()
    for (const wallet of wallets) {
      const [balance, sent] = await Promise.all([
        client.getBalance({ address: wallet.address }),
        client.getTransactionCount({ address: wallet.address }),
      ])
      console.log(
        `${wallet.name}  ${wallet.address}  ${Number(formatEther(balance)).toFixed(4)} MON  ${sent} tx sent`,
      )
      console.log(`  ${wallet.link}`)
    }
  } else if (command === 'sweep') {
    const to = flags.to
    if (!/^0x[0-9a-fA-F]{40}$/.test(to ?? '')) throw new Error('--to must be your wallet address')
    const { wallets } = load()
    const chain = {
      id: await client.getChainId(),
      name: 'monad',
      nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
      rpcUrls: { default: { http: [rpc] } },
    }
    for (const wallet of wallets) {
      const account = privateKeyToAccount(wallet.key)
      const balance = await client.getBalance({ address: account.address })
      // Estimate instead of assuming 21,000: the recipient may be a smart / EIP-7702 account.
      const gas = await client.estimateGas({ account: account.address, to, value: 1n })
      const { maxFeePerGas } = await client.estimateFeesPerGas()
      const value = balance - gas * maxFeePerGas
      if (value <= 0n) {
        console.log(`${wallet.name}: nothing worth sweeping`)
        continue
      }
      const wallet_ = createWalletClient({ account, chain, transport: http(rpc) })
      const hash = await wallet_.sendTransaction({ to, value, gas, maxFeePerGas })
      console.log(`${wallet.name}: swept ${formatEther(value)} MON → ${to} (${hash})`)
    }
  } else {
    console.log(
      'usage: node scripts/guest-wallets.mjs create [--count 5] | status | sweep --to 0xYourWallet  [--rpc URL]',
    )
    process.exit(command ? 2 : 0)
  }
} catch (error) {
  console.error(`guest-wallets: ${safe(error)}`)
  process.exit(1)
}
