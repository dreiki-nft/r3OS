import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DEPLOYMENT_STEPS,
  EXPECTED_MAINNET_BUDGETS,
  MAINNET_MANIFEST_SCHEMA,
  OFFICIAL_MAINNET,
  makeManifest,
  validateManifestInput,
} from './mainnet-manifest-lib.mjs'

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`
const input = () => ({
  schema: MAINNET_MANIFEST_SCHEMA,
  reviewed: true,
  chainId: 143,
  deployer: address(1),
  finalOwner: address(2),
  tokenZeroRecipient: address(3),
  royaltyReceiver: address(3),
  r3tards: OFFICIAL_MAINNET.r3tards,
  partners: { skrumpeys: OFFICIAL_MAINNET.skrumpeys, monadCards: OFFICIAL_MAINNET.monadCards },
  seasonStart: 1_800_000_000,
  budgets: { ...EXPECTED_MAINNET_BUDGETS },
  labBaseUri: '',
  systemEvent: { monUsdFeed: OFFICIAL_MAINNET.monUsdFeed, triggerMilliUsd: 333, maxAgeSeconds: 90 },
  freezeIntentions: { renderers: 'freeze-after-acceptance', experiments: 'keep-open' },
  frontend: {
    rpcUrls: ['https://rpc.monad.xyz', 'https://rpc-mainnet.monadinfra.com'],
    walletRpcUrl: 'https://rpc.monad.xyz',
    wsUrl: 'wss://rpc.monad.xyz',
    explorerUrl: 'https://monadvision.com',
    fastlaneAcceleratorUrl: 'https://r3os-fastlane.example/v1/boot-rpc',
  },
  confirmMainnet: true,
})

describe('mainnet deployment manifest', () => {
  it('locks the exact reviewed deployment order and approval boundaries', () => {
    expect(DEPLOYMENT_STEPS.map((step) => step.id)).toEqual([
      'core', 'card', 'hardware', 'operator', 'router', 'preaccept-doctor',
      'accept-ownership', 'optional-freezes', 'postaccept-doctor', 'flight-recorder',
    ])
    const { markdown } = makeManifest(input())
    expect(markdown.indexOf('CARD.DRV')).toBeLessThan(markdown.indexOf('Monad Hardware'))
    expect(markdown.indexOf('Monad Hardware')).toBeLessThan(markdown.indexOf('Ownership acceptance'))
    expect(markdown).toContain('Do not let the final owner accept Paint ownership before Monad Hardware registration completes.')
    expect(markdown).toContain('IRREVERSIBLE ADMIN GATE')
    expect(markdown).toContain('IRREVERSIBLE FREEZE GATE')
    expect(markdown).toContain('https://r3os-fastlane.example/v1/boot-rpc')
    expect(markdown).toContain('FastLane Enterprise credential is never browser-visible')
  })

  it('fails closed on chain, partner, budget, freeze-policy and RPC drift', () => {
    const bad = input()
    bad.chainId = 10143
    bad.partners.monadCards = address(99)
    bad.budgets.holderPixelsPerDay = 511
    bad.freezeIntentions.experiments = 'freeze-after-acceptance'
    bad.frontend.rpcUrls = ['https://only-one.example']
    expect(validateManifestInput(bad)).toEqual(expect.arrayContaining([
      'chainId must be 143',
      `monadCards must be ${OFFICIAL_MAINNET.monadCards}`,
      'budgets.holderPixelsPerDay must be 512',
      'freezeIntentions.experiments must be keep-open for the reviewed Phase 9 launch policy',
      'frontend.rpcUrls must contain at least two public/read-safe RPC URLs',
    ]))
  })

  it('stays aligned with the deployment scripts that make ordering safety-critical', () => {
    const core = readFileSync('contracts/script/Deploy.s.sol', 'utf8')
    const card = readFileSync('contracts/script/DeployMonadCard.s.sol', 'utf8')
    const hardware = readFileSync('contracts/script/DeployMonadHW.s.sol', 'utf8')
    expect(core).toContain('paint.transferOwnership(finalOwner)')
    expect(core).toContain('labs.transferOwnership(finalOwner)')
    expect(card).toContain('new R3OSCardMemory(cardAddress)')
    expect(hardware).toContain('new R3OSBlockCamera(address(paint), address(labs), cardMemory)')
    expect(hardware).toContain('paint.addExperiment(address(page), "page-exe", "")')
    expect(hardware).toContain('paint.addExperiment(address(camera), "block-camera", "")')
    expect(hardware).not.toContain('SAFE calldata')
  })

  it('produces a stable canonical manifest hash', () => {
    const a = input()
    const b = { ...a, frontend: { ...a.frontend }, partners: { ...a.partners }, budgets: { ...a.budgets } }
    expect(makeManifest(a).hash).toBe(makeManifest(b).hash)
  })
})
