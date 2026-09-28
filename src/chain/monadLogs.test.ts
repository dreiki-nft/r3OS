import { describe, expect, it } from 'vitest'
import { decodeMonadNotification } from './monadLogs'

const hash = `0x${'22'.repeat(32)}`
const blockId = `0x${'ab'.repeat(32)}`

describe('monadLogs decoder', () => {
  it('unwraps Proposed, Voted and Finalized notifications', () => {
    expect(
      decodeMonadNotification({
        params: {
          result: {
            blockId,
            commitState: 'Proposed',
            transactionHash: hash,
            log: { blockNumber: '0xa' },
          },
        },
      }),
    ).toEqual({ blockId, blockNumber: 10n, commitState: 'Proposed', transactionHash: hash })
    expect(
      decodeMonadNotification({ data: { commitState: 'Voted', transactionHash: hash } })?.commitState,
    ).toBe('Voted')
    expect(decodeMonadNotification({ commitState: 'Finalized', transactionHash: hash })?.commitState).toBe(
      'Finalized',
    )
  })

  it('does not recurse forever when a block number is missing', () => {
    expect(decodeMonadNotification({ commitState: 'Proposed', transactionHash: hash })).toEqual({
      blockId: undefined,
      blockNumber: undefined,
      commitState: 'Proposed',
      transactionHash: hash,
    })
  })
})
