import { describe, expect, it } from 'vitest'
import { FORWARDING_COPY, ROUTER_COPY } from './copy'

const banned = [
  'best route',
  'safe',
  'protected',
  'mev-free',
  'private',
  'cannot be sandwiched',
  'spoofing',
  'lying',
  'manipulated',
  'broken',
  'health',
  'score',
]

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}

describe('ROUTER / forwarding copy', () => {
  it('does not use prohibited claims or labels', () => {
    const text = strings({ ROUTER_COPY, FORWARDING_COPY }).join('\n').toLowerCase()
    for (const word of banned) expect(text).not.toContain(word)
  })

  it('always labels the interface as a draft', () => {
    expect(ROUTER_COPY.draft).toBe('MRC-17 DRAFT')
    expect(ROUTER_COPY.highest).toBe('HIGHEST QUOTED OUTPUT')
  })
})
