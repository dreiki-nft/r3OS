import { describe, expect, it } from 'vitest'
import { shouldRecordRemoteRender } from './renderPerf'

describe('remote render performance eligibility', () => {
  it('records an uninterrupted visible-tab render', () => {
    expect(shouldRecordRemoteRender(100, 20, false)).toBe(true)
  })

  it('ignores a probe if the tab visibility changed after the event arrived', () => {
    expect(shouldRecordRemoteRender(100, 150, false)).toBe(false)
  })

  it('ignores a render while the document is hidden', () => {
    expect(shouldRecordRemoteRender(100, 20, true)).toBe(false)
  })
})
