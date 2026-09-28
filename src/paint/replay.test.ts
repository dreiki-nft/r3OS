import { describe, expect, it } from 'vitest'
import { applyPainted, replayLogs } from './replay'
describe('replay', () => {
  it('skips outline then applies corruption after runs', () => {
    const b = new Uint8Array(65536),
      o = new Uint8Array(65536)
    o[1] = 1
    const out = applyPainted(b, o, Uint8Array.from([0, 0, 2, 4]), Uint8Array.from([0, 0, 7]))
    expect([...out.slice(0, 3)]).toEqual([7, 0, 4])
  })
  it('sorts logs and ignores snapshot history', () => {
    const b = new Uint8Array(65536),
      o = new Uint8Array(65536)
    const out = replayLogs(
      b,
      o,
      [
        { blockNumber: 3n, logIndex: 0, runs: Uint8Array.from([0, 0, 0, 3]), corruptions: new Uint8Array() },
        { blockNumber: 1n, logIndex: 0, runs: Uint8Array.from([0, 0, 0, 1]), corruptions: new Uint8Array() },
      ],
      1n,
    )
    expect(out[0]).toBe(3)
  })
})
