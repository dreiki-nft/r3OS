import { describe, expect, it } from 'vitest'
import * as copy from './copy'

const banned = [
  'token',
  'airdrop',
  'presale',
  'allocation',
  'claim',
  'reward',
  'points',
  'score',
  'rank',
  'level',
  'xp',
  'eligib',
  'farm',
  'earn',
  'whitelist',
  'allowlist',
  'snapshot',
  'drop',
]

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}

describe('operator phase copy', () => {
  it('contains none of the prohibited stems', () => {
    const all = strings(copy).join('\n').toLowerCase()
    for (const stem of banned) expect(all, `copy contains banned stem: ${stem}`).not.toContain(stem)
  })
})
