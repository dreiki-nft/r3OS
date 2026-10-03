import { describe, expect, it } from 'vitest'
import type { Address } from 'viem'
import { applyLabsTransfer, ownedFromOwnerScan } from './labsStore'

const me = '0x00000000000000000000000000000000000000aa' as Address
const other = '0x00000000000000000000000000000000000000bb' as Address

describe('Labs folder ownership', () => {
  it('skips burned ownerOf gaps', () => {
    const rows = [
      { status: 'success', result: me },
      { status: 'failure', error: new Error('burned') },
      { status: 'success', result: other },
      { status: 'success', result: me },
    ]
    expect(ownedFromOwnerScan(rows, me)).toEqual([1n, 4n])
  })
  it('moves tokens in and out on Transfer', () => {
    expect(applyLabsTransfer([1n], me, other, me, 2n)).toEqual([1n, 2n])
    expect(applyLabsTransfer([1n, 2n], me, me, other, 1n)).toEqual([2n])
  })
})
