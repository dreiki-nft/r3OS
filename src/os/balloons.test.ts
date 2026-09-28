import { beforeEach, describe, expect, it } from 'vitest'
import { clearBalloons, getBalloons, pushBalloon } from './balloons'

describe('connection balloon', () => {
  beforeEach(clearBalloons)

  it('keeps exactly one connection notice when pushed twice', () => {
    pushBalloon({ id: 'connection', title: 'Connection', body: 'first' })
    pushBalloon({ id: 'connection', title: 'Connection', body: 'second' })

    const connection = getBalloons().filter((notice) => notice.id === 'connection')
    expect(connection).toHaveLength(1)
    expect(connection[0].body).toBe('second')
  })
})
