import { describe, expect, it } from 'vitest'
import { catchableAt } from './BlockDNAProgram'

describe('Block DNA catch window', () => {
  it('keeps the 256-block edge catchable and rejects the next block', () => {
    expect(catchableAt(1_000n, 744n)).toBe(true)
    expect(catchableAt(1_000n, 743n)).toBe(false)
    expect(catchableAt(1_000n, 1_000n)).toBe(false)
  })
})
