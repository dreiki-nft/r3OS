import { readdirSync, statSync } from 'node:fs'
import { join, parse } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Windows and default macOS file systems are case-insensitive, Linux CI is not. Two modules in one folder whose
 * names differ only by case (e.g. `ContextMenu.tsx` and `contextMenu.ts`) build on CI but resolve to the wrong
 * file on a developer's machine. Same name with a different extension (`cdrom.ts` + `cdrom.css`) is fine.
 */
function collisions(dir: string): string[] {
  const found: string[] = []
  const byLower = new Map<string, Set<string>>()
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      found.push(...collisions(path))
      continue
    }
    const { name } = parse(entry)
    const key = name.toLowerCase()
    if (!byLower.has(key)) byLower.set(key, new Set())
    byLower.get(key)!.add(name)
  }
  for (const names of byLower.values()) if (names.size > 1) found.push(`${dir}: ${[...names].join(' vs ')}`)
  return found
}

describe('source file names', () => {
  it('has no names that differ only by letter case', () => {
    expect(collisions('src')).toEqual([])
    expect(collisions('scripts')).toEqual([])
  })
})
