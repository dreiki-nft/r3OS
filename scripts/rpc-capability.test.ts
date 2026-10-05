import { describe, expect, it } from 'vitest'
import { browserDecision, normalizePolicy } from './rpc-capability-lib.mjs'

describe('RPC browser policy', () => {
  it('never treats CORS alone as permission to expose a credential', () => {
    expect(browserDecision({ technicalBrowserEligible: true, policy: 'unverified' })).toBe(
      'BLOCKED_POLICY_UNVERIFIED',
    )
  })

  it('blocks provider-declared server secrets even when transport is browser reachable', () => {
    expect(browserDecision({ technicalBrowserEligible: true, policy: 'secret-server' })).toBe(
      'BLOCKED_SECRET_CREDENTIAL',
    )
  })

  it('allows only an explicitly browser-public credential with working browser transport', () => {
    expect(browserDecision({ technicalBrowserEligible: true, policy: 'public-browser' })).toBe(
      'ELIGIBLE_AS_BROWSER_RPC_LANE',
    )
    expect(browserDecision({ technicalBrowserEligible: false, policy: 'public-browser' })).toBe(
      'BLOCKED_BROWSER_TRANSPORT',
    )
    expect(normalizePolicy('something-creative')).toBe('unverified')
  })
})
