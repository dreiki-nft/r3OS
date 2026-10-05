import fs from 'node:fs/promises'
import path from 'node:path'
import { probeRpcCapability } from './rpc-capability-lib.mjs'

const url = process.env.FASTLANE_RPC_URL || process.env.RPC_PROBE_URL || ''
if (!url) {
  console.error('FASTLANE_RPC_URL is required in your local shell. Do not paste it into chat or put it in VITE_ variables.')
  process.exit(1)
}

const batchSizes = String(process.env.FASTLANE_PROBE_BATCH_SIZES || '1,5,20')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0)

try {
  const report = await probeRpcCapability({
    url,
    origin: process.env.FASTLANE_PROBE_ORIGIN || 'https://r3os.invalid',
    policy: process.env.FASTLANE_BROWSER_POLICY || 'unverified',
    batchSizes,
  })
  await fs.mkdir(path.resolve('artifacts'), { recursive: true })
  const output = path.resolve('artifacts/fastlane-capability.json')
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`)

  console.log('FastLane / RPC capability probe')
  console.log(`chain: ${report.chainId ?? 'unknown'}`)
  console.log(`client: ${report.clientVersion ?? 'unknown'}`)
  console.log(`browser transport: ${report.browser.technicalBrowserEligible ? 'technically reachable' : 'not proven'}`)
  console.log(`credential policy: ${report.credentialPolicy}`)
  console.log(`decision: ${report.browser.decision}`)
  console.log(`cold chainId: ${report.timings.coldChainIdMs.toFixed(0)} ms`)
  console.log(`warm sequential: ${report.timings.warmSequential.map((row) => `${row.ms.toFixed(0)} ms`).join(', ')}`)
  console.log(`capability batch: ${report.timings.capabilityBatchMs.toFixed(0)} ms`)
  for (const row of report.timings.batchBenchmarks) {
    console.log(`batch ${row.size}: ${row.ms.toFixed(0)} ms · ${row.successCount}/${row.size} successful`)
  }
  console.log(`wrote ${path.relative(process.cwd(), output)} (endpoint URL omitted)`)
} catch (error) {
  console.error(`RPC capability probe failed: ${error instanceof Error ? error.name : 'Error'}`)
  process.exit(1)
}
