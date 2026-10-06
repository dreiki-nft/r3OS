import { describe, expect, it } from 'vitest'
import {
  assessDeploymentStages,
  extractJournalContracts,
  mergeContractEvidence,
  verifyFoundryCreatesAgainstJournals,
} from './deployment-addresses-lib.mjs'

const address = (n: number) => `0x${n.toString(16).padStart(40, '0')}`
const tx = (contractName: string, n: number) => ({ transactionType: 'CREATE', contractName, contractAddress: address(n) })
const finalized = (contractAddress: string | null = null) => ({
  state: 'FINALIZED',
  receipt: { status: '0x1', contractAddress },
})

describe('guarded mainnet deployment evidence', () => {
  it('extracts Hardware CREATE addresses only from successful finalized receipts', () => {
    const journal = {
      schema: 'r3os-monad-hardware-broadcast/v1',
      pageExe: address(12),
      blockCamera: address(13),
      entries: [finalized(address(12)), finalized(address(13)), finalized(), finalized(), finalized()],
    }
    expect(extractJournalContracts(journal, 'hardware.json')).toEqual([
      { contractName: 'R3OSPageExe', address: address(12), source: 'hardware.json', evidenceKind: 'guarded-journal' },
      { contractName: 'R3OSBlockCamera', address: address(13), source: 'hardware.json', evidenceKind: 'guarded-journal' },
    ])
  })

  it('accepts the reviewed recovery shapes and Hardware post-check abort after all txs finalized', () => {
    const coreIncident = {
      schema: 'r3os-core-manual-broadcast/v1',
      entries: [...Array.from({ length: 6 }, () => finalized()), { state: 'REVERTED', receipt: { status: '0x0' } }],
    }
    const coreRecovery = {
      schema: 'r3os-core-recovery-broadcast/v1',
      state: 'COMPLETE',
      entries: Array.from({ length: 22 }, () => finalized()),
    }
    const cardIncident = {
      schema: 'r3os-card-drv-broadcast/v1',
      cardMemory: address(11),
      entries: [finalized(address(11)), finalized()],
    }
    const cardRecovery = {
      schema: 'r3os-card-drv-recovery/v1',
      state: 'COMPLETE',
      entries: [finalized(), finalized()],
    }
    const hardware = {
      schema: 'r3os-monad-hardware-broadcast/v1',
      pageExe: address(12),
      blockCamera: address(13),
      entries: [finalized(address(12)), finalized(address(13)), finalized(), finalized(), finalized()],
    }
    const operator = {
      schema: 'r3os-operator-system-event-broadcast/v1',
      state: 'COMPLETE',
      operatorRecord: address(14),
      systemEvent: address(15),
      entries: [finalized(address(14)), finalized(address(15)), finalized(), finalized()],
    }
    const router = {
      schema: 'r3os-router-lab-broadcast/v1',
      state: 'COMPLETE',
      routerLab: address(16),
      entries: [finalized(address(16)), finalized()],
    }

    const result = assessDeploymentStages([
      { source: 'core.json', journal: coreIncident },
      { source: 'core-recovery.json', journal: coreRecovery },
      { source: 'card.json', journal: cardIncident },
      { source: 'card-recovery.json', journal: cardRecovery },
      { source: 'hardware.json', journal: hardware },
      { source: 'operator.json', journal: operator },
      { source: 'router.json', journal: router },
    ])

    expect(result.complete).toBe(true)
    expect(result.stages.core.mode).toBe('recovered')
    expect(result.stages.cardDrv.mode).toBe('recovered')
    expect(result.stages.monadHardware.mode).toBe('finalized-postcheck-abort')
  })

  it('cross-checks reviewed Foundry CREATE addresses against finalized guarded-journal receipts', () => {
    const run = { transactions: [tx('R3OSPaint', 1), tx('R3OSLabs', 2)] }
    const journals = [{ source: 'core.json', journal: { entries: [finalized(address(1)), finalized(address(2))] } }]
    expect(verifyFoundryCreatesAgainstJournals(run, journals, 'core')).toBe(2)
    expect(() => verifyFoundryCreatesAgainstJournals({ transactions: [tx('R3OSPaint', 3)] }, journals, 'core'))
      .toThrow(/no matching successful finalized CREATE receipt/)
  })

  it('refuses conflicting addresses across Foundry and journal evidence', () => {
    expect(() => mergeContractEvidence([
      { contractName: 'R3OSPaint', address: address(1), source: 'a.json', evidenceKind: 'foundry-artifact' },
      { contractName: 'R3OSPaint', address: address(2), source: 'b.json', evidenceKind: 'guarded-journal' },
    ])).toThrow(/conflicting R3OSPaint addresses/)
  })
})
