import { describe, expect, it } from 'vitest'
import { dropOrder, rowOverflows } from './trayFit'

describe('tray fit', () => {
  it('measures the row with gaps between visible items only', () => {
    expect(rowOverflows([100, 100], 2, 202)).toBe(false)
    expect(rowOverflows([100, 100], 2, 201)).toBe(true)
    // A hidden item (width 0) neither takes room nor adds a gap.
    expect(rowOverflows([100, 0, 100], 2, 202)).toBe(false)
  })

  it('drops the least important first: storm word, connection, LIVE key, painters, mail, mute, pulse dot', () => {
    const parts = [
      { name: 'mute', drop: 6 },
      { name: 'storm word', drop: 1 },
      { name: 'connection', drop: 2 },
      { name: 'live key', drop: 3 },
      { name: 'mail', drop: 5 },
      { name: 'painters', drop: 4 },
      { name: 'dot', drop: 7 },
    ]
    expect(dropOrder(parts).map((part) => part.name)).toEqual([
      'storm word',
      'connection',
      'live key',
      'painters',
      'mail',
      'mute',
      'dot',
    ])
  })
})
