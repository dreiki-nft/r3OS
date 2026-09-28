import { describe, expect, it } from 'vitest'
import { applyRedo, applyUndo, type PaintHistoryStacks } from './history'

function bytes(...values: number[]) {
  return Uint8Array.from(values)
}

describe('paint history', () => {
  it('undo then redo returns to the same working buffer', () => {
    const original = bytes(1, 2, 3)
    const edited = bytes(1, 9, 3)
    const stacks: PaintHistoryStacks = { undo: [original], redo: [] }

    const undone = applyUndo(stacks, edited)
    const redone = applyRedo(undone.stacks, undone.working)

    expect([...undone.working]).toEqual([...original])
    expect([...redone.working]).toEqual([...edited])
  })

  it('is pure when React-style double invocation repeats the same input', () => {
    const original = bytes(4, 5, 6)
    const edited = bytes(4, 8, 6)
    const stacks: PaintHistoryStacks = { undo: [original], redo: [] }

    const first = applyUndo(stacks, edited)
    const second = applyUndo(stacks, edited)

    expect([...first.working]).toEqual([...second.working])
    expect(first.stacks.undo).toHaveLength(0)
    expect(second.stacks.undo).toHaveLength(0)
    expect(stacks.undo).toHaveLength(1)
    expect(stacks.redo).toHaveLength(0)
  })
})
