import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BACKGROUND_CHOICES, PALETTE } from '../src/lib/palette'

const contract = readFileSync(new URL('../contracts/src/R3OSPaint.sol', import.meta.url), 'utf8')

describe('background colours', () => {
  it('offers exactly the colours the Paint contract accepts', () => {
    const body = contract.match(/function _allowedBackground[^{]*\{([^}]*)\}/)?.[1] ?? ''
    const allowed = [...body.matchAll(/color == (\d+)/g)].map((m) => Number(m[1]))
    expect(allowed.length).toBeGreaterThan(0)
    expect(BACKGROUND_CHOICES.map((c) => c.index)).toEqual(allowed)
  })

  it("uses the contract's own names for them", () => {
    const body = contract.match(/function _backgroundName[^{]*\{([\s\S]*?)\n    \}/)?.[1] ?? ''
    for (const choice of BACKGROUND_CHOICES) {
      const named = body.match(new RegExp(`color == ${choice.index}\\) return "([^"]+)"`))?.[1]
      // The last colour is the function's fallback return.
      expect(named ?? body.match(/return "([^"]+)";\s*$/)?.[1]).toBe(choice.name)
    }
    for (const choice of BACKGROUND_CHOICES) expect(PALETTE[choice.index]).toBeDefined()
  })
})
