export const MAINNET_REHEARSAL_SCHEMA = 'r3os-mainnet-rehearsal/v1'

const TRUEISH = new Set(['1', 'true', 'yes', 'on'])
const APPROVAL_FLAGS = Object.freeze([
  'CONFIRM_MAINNET',
  'CONFIRM_ACCEPT_OWNERSHIP',
  'CONFIRM_FREEZE_RENDERERS',
])

const shellQuote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`

export function isTruthyEnv(value) {
  return TRUEISH.has(String(value ?? '').trim().toLowerCase())
}

export function assertRehearsalDisarmed(env = process.env) {
  const armed = APPROVAL_FLAGS.filter((name) => isTruthyEnv(env[name]))
  if (armed.length) {
    throw new Error(
      `rehearsal blocked: approval flag(s) armed in shell: ${armed.join(', ')}; unset them before any read-only/dry-run rehearsal`,
    )
  }
}

export function foundryEnvFromManifest(manifest) {
  const b = manifest.budgets
  const s = manifest.systemEvent
  return {
    DEPLOYER_ADDRESS: manifest.deployer,
    R3TARDS_ADDRESS: manifest.r3tards,
    SEASON_START: String(manifest.seasonStart),
    TOKEN_ZERO_RECIPIENT: manifest.tokenZeroRecipient,
    ROYALTY_RECEIVER: manifest.royaltyReceiver,
    FINAL_OWNER: manifest.finalOwner,
    BASE_PIXELS_PER_HOUR: String(b.basePixelsPerHour),
    PIXELS_PER_ACTIVE_DAY: String(b.pixelsPerActiveDay),
    MAX_PIXELS_PER_HOUR: String(b.maxPixelsPerHour),
    MIN_PIXELS_FOR_ACTIVE_DAY: String(b.minPixelsForActiveDay),
    HOLDER_PIXELS_PER_DAY: String(b.holderPixelsPerDay),
    LAB_BASE_URI: manifest.labBaseUri,
    MONAD_CARD_ADDRESS: manifest.partners.monadCards,
    MON_USD_FEED: s.monUsdFeed,
    MON_PRICE_TRIGGER_MILLI_USD: String(s.triggerMilliUsd),
    MON_FEED_MAX_AGE: String(s.maxAgeSeconds),
    DEPLOY_MOCK_VENUES: 'false',
  }
}

export function formatFoundryEnv(env) {
  const lines = [
    '# Generated from the reviewed r3OS PLAN_ONLY manifest.',
    '# Public deployment parameters only. Contains no RPC URL, signer secret, or approval flag.',
  ]
  for (const [key, value] of Object.entries(env)) lines.push(`export ${key}=${shellQuote(value)}`)
  lines.push('')
  return lines.join('\n')
}

export function coreDryRunArgs() {
  return [
    'script',
    'script/Deploy.s.sol:Deploy',
    '--rpc-url',
    '__RPC_URL__',
    '-vvvv',
  ]
}

export function assertDryRunArgsSafe(args) {
  const lowered = args.map((value) => String(value).toLowerCase())
  if (lowered.includes('--broadcast') || lowered.includes('--resume')) {
    throw new Error('rehearsal command must never contain --broadcast or --resume')
  }
}

export function hasStaleBuildArtifactsWarning(text) {
  return /detected artifacts built from source files that no longer exist/i.test(String(text ?? ''))
}

export function parseFoundryDryRunSummary(text) {
  const source = String(text ?? '')
  const firstNumber = (pattern) => {
    const match = source.match(pattern)
    return match ? Number(match[1]) : null
  }
  const gasLimits = [...source.matchAll(/^gasLimit\s+(\d+)$/gim)].map((match) => Number(match[1]))
  return {
    transactionCount: [...source.matchAll(/### Transaction\s+\d+\s+###/g)].length,
    estimatedGasLimitTotal: firstNumber(/Estimated total gas used for script:\s*(\d+)/i),
    maxTransactionGasLimit: gasLimits.length ? Math.max(...gasLimits) : null,
    estimatedMaxFeePerGasGwei: firstNumber(/Estimated max fee per gas:\s*([0-9.]+)\s*gwei/i),
    estimatedBaseFeePerGasGwei: firstNumber(/Estimated base fee per gas:\s*([0-9.]+)\s*gwei/i),
    estimatedPriorityFeePerGasGwei: firstNumber(/Estimated max priority fee per gas:\s*([0-9.]+)\s*gwei/i),
    estimatedMaxAmountRequiredMon: firstNumber(/Estimated amount required:\s*([0-9.]+)\s*MON/i),
  }
}

export function redactSecrets(text, secrets = []) {
  let out = String(text ?? '')
  for (const secret of secrets) {
    if (!secret) continue
    out = out.split(String(secret)).join('<REDACTED_RPC_URL>')
  }
  return out
}
