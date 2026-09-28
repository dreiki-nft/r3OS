export interface PaintHistoryStacks {
  undo: readonly Uint8Array[]
  redo: readonly Uint8Array[]
}

export interface PaintHistoryResult {
  stacks: { undo: Uint8Array[]; redo: Uint8Array[] }
  working: Uint8Array
  changed: boolean
}

function appendHistory(stack: readonly Uint8Array[], entry: Uint8Array) {
  return [...stack.slice(-29), entry.slice()]
}

export function applyUndo(stacks: PaintHistoryStacks, working: Uint8Array): PaintHistoryResult {
  const previous = stacks.undo.at(-1)
  if (!previous) {
    return {
      stacks: { undo: [...stacks.undo], redo: [...stacks.redo] },
      working,
      changed: false,
    }
  }

  return {
    stacks: {
      undo: stacks.undo.slice(0, -1),
      redo: appendHistory(stacks.redo, working),
    },
    working: previous.slice(),
    changed: true,
  }
}

export function applyRedo(stacks: PaintHistoryStacks, working: Uint8Array): PaintHistoryResult {
  const next = stacks.redo.at(-1)
  if (!next) {
    return {
      stacks: { undo: [...stacks.undo], redo: [...stacks.redo] },
      working,
      changed: false,
    }
  }

  return {
    stacks: {
      undo: appendHistory(stacks.undo, working),
      redo: stacks.redo.slice(0, -1),
    },
    working: next.slice(),
    changed: true,
  }
}
