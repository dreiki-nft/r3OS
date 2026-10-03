import { describe, expect, it } from 'vitest'
import {
  bootPrefetchComplete,
  bootPrefetchProgress,
  bootPrefetchReady,
  bootPrefetchRows,
  type BootPrefetchSnapshot,
  type BootPrefetchTask,
} from './bootPrefetch'

function task(id: string, critical: boolean, state: BootPrefetchTask['state']): BootPrefetchTask {
  return { id, label: id, critical, state }
}

function snap(tasks: BootPrefetchTask[]): BootPrefetchSnapshot {
  return { version: 1, tasks }
}

describe('boot prefetch state', () => {
  it('releases the desktop when every critical task has settled, even if background art is still running', () => {
    const input = snap([
      task('programs', true, 'done'),
      task('rpc', true, 'error'),
      task('account', true, 'skipped'),
      task('art', false, 'running'),
    ])
    expect(bootPrefetchReady(input)).toBe(true)
    expect(bootPrefetchComplete(input)).toBe(false)
    expect(bootPrefetchProgress(input)).toEqual({ done: 3, total: 3 })
  })

  it('keeps the desktop gated while a critical task is still running', () => {
    const input = snap([task('programs', true, 'done'), task('canvas', true, 'running')])
    expect(bootPrefetchReady(input)).toBe(false)
    expect(bootPrefetchProgress(input)).toEqual({ done: 1, total: 2 })
  })

  it('shows critical rows plus any background work that is actively running', () => {
    const input = snap([
      task('programs', true, 'done'),
      task('account', true, 'running'),
      task('art', false, 'pending'),
      task('other', false, 'running'),
    ])
    expect(bootPrefetchRows(input).map((row) => row.id)).toEqual(['programs', 'account', 'other'])
  })
})
