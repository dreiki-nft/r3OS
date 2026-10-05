import { describe, expect, it } from 'vitest'
import {
  assertDryRunArgsSafe,
  assertRehearsalDisarmed,
  coreDryRunArgs,
  formatFoundryEnv,
  foundryEnvFromManifest,
  hasStaleBuildArtifactsWarning,
  parseFoundryDryRunSummary,
  redactSecrets,
} from './mainnet-rehearse-lib.mjs'

const manifest = {
  deployer: '0x1111111111111111111111111111111111111111',
  finalOwner: '0x2222222222222222222222222222222222222222',
  tokenZeroRecipient: '0x3333333333333333333333333333333333333333',
  royaltyReceiver: '0x4444444444444444444444444444444444444444',
  r3tards: '0x200723A706de0013316E5cd8EBa2b3f53DD90c29',
  seasonStart: 1_800_000_000,
  budgets: {
    basePixelsPerHour: 512,
    pixelsPerActiveDay: 32,
    maxPixelsPerHour: 2048,
    minPixelsForActiveDay: 16,
    holderPixelsPerDay: 512,
  },
  partners: { monadCards: '0x0000CA12D5c07085022eBC74867157449919Fd67' },
  labBaseUri: '',
  systemEvent: {
    monUsdFeed: '0xBcD78f76005B7515837af6b50c7C52BCf73822fb',
    triggerMilliUsd: 333,
    maxAgeSeconds: 3600,
  },
}

describe('mainnet rehearsal safety', () => {
  it('refuses to run if any irreversible approval flag is armed', () => {
    expect(() => assertRehearsalDisarmed({ CONFIRM_MAINNET: 'true' })).toThrow(/CONFIRM_MAINNET/)
    expect(() => assertRehearsalDisarmed({ CONFIRM_ACCEPT_OWNERSHIP: '1' })).toThrow(/CONFIRM_ACCEPT_OWNERSHIP/)
    expect(() => assertRehearsalDisarmed({ CONFIRM_FREEZE_RENDERERS: 'yes' })).toThrow(/CONFIRM_FREEZE_RENDERERS/)
    expect(() => assertRehearsalDisarmed({ CONFIRM_MAINNET: 'false' })).not.toThrow()
  })

  it('derives Foundry values from the reviewed manifest without any approval flag', () => {
    const env = foundryEnvFromManifest(manifest)
    expect(env.DEPLOYER_ADDRESS).toBe(manifest.deployer)
    expect(env.FINAL_OWNER).toBe(manifest.finalOwner)
    expect(env.MON_FEED_MAX_AGE).toBe('3600')
    expect(env.DEPLOY_MOCK_VENUES).toBe('false')
    expect(Object.keys(env).some((key) => key.startsWith('CONFIRM_'))).toBe(false)
    const text = formatFoundryEnv(env)
    expect(text).toContain("export DEPLOYER_ADDRESS='0x1111111111111111111111111111111111111111'")
    expect(text).not.toContain('CONFIRM_MAINNET')
  })

  it('hard-codes a core simulation command with no broadcast/resume flag and redacts RPC secrets', () => {
    const args = coreDryRunArgs()
    expect(args).not.toContain('--broadcast')
    expect(args).not.toContain('--resume')
    expect(args).not.toContain('--root')
    expect(() => assertDryRunArgsSafe(args)).not.toThrow()
    expect(() => assertDryRunArgsSafe([...args, '--broadcast'])).toThrow(/never contain/)
    expect(redactSecrets('rpc=https://secret.example/key', ['https://secret.example/key'])).toBe('rpc=<REDACTED_RPC_URL>')
  })

  it('fails closed on stale build artifacts and records Monad gas evidence', () => {
    const sample = `
Estimated max fee per gas: 205 gwei
Estimated base fee per gas: 100 gwei
Estimated max priority fee per gas: 5 gwei
Estimated total gas used for script: 54467082
Estimated amount required: 11.16575181 MON
### Transaction 1 ###
gasLimit             23661866
### Transaction 2 ###
gasLimit             4606635
`
    expect(hasStaleBuildArtifactsWarning(sample)).toBe(false)
    expect(hasStaleBuildArtifactsWarning(`${sample}\nWarning: Detected artifacts built from source files that no longer exist.`)).toBe(true)
    expect(parseFoundryDryRunSummary(sample)).toEqual({
      transactionCount: 2,
      estimatedGasLimitTotal: 54467082,
      maxTransactionGasLimit: 23661866,
      estimatedMaxFeePerGasGwei: 205,
      estimatedBaseFeePerGasGwei: 100,
      estimatedPriorityFeePerGasGwei: 5,
      estimatedMaxAmountRequiredMon: 11.16575181,
    })
  })
})
