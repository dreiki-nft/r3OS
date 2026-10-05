import { describe, expect, it } from 'vitest'
import { readHeavyUsing } from '../chain/readMany'
import {
  beginInFlight,
  clearMatchingInFlight,
  createSerialQueue,
} from '../paint/canvasStore'
import { spendObservedBudget } from '../paint/budget'

describe('State and long-session stress', () => {
  it('keeps locally re-edited pixels pending across 1,000 receipt-clear simulations', () => {
    for (let round = 0; round < 1_000; round++) {
      const background = new Uint8Array(65_536)
      const working = background.slice()
      const x = round % 200
      const y = Math.floor(round / 200) % 2
      const colour = (round % 15) + 1
      const runs = Uint8Array.from([y, x, x, colour])
      const sent = beginInFlight(runs)
      const index = y * 256 + x
      working[index] = colour

      if (round % 3 === 0) working[index] = colour === 15 ? 14 : colour + 1
      const cleared = clearMatchingInFlight(working, background, sent)

      if (round % 3 === 0) expect(cleared[index]).toBe(working[index])
      else expect(cleared[index]).toBe(background[index])
    }
  })

  it('keeps the reconciliation serial queue alive after repeated job failures', async () => {
    const enqueue = createSerialQueue()
    const order: number[] = []
    const jobs = Array.from({ length: 500 }, (_, index) =>
      enqueue(async () => {
        order.push(index)
        if (index % 37 === 0) throw new Error(`synthetic failure ${index}`)
        return index
      }).catch(() => undefined),
    )
    await Promise.all(jobs)
    expect(order).toHaveLength(500)
    expect(order).toEqual(Array.from({ length: 500 }, (_, index) => index))
  })

  it('never lets event-derived budget accounting underflow during a long paint burst', () => {
    let budget = { hourly: 512, hourlyLimit: 512, holder: 2_048, total: 2_560, activeDays: 1 }
    for (let index = 0; index < 10_000; index++) {
      budget = spendObservedBudget(budget, (index % 7) + 1)
      expect(budget.hourly).toBeGreaterThanOrEqual(0)
      expect(budget.holder).toBeGreaterThanOrEqual(0)
      expect(budget.total).toBe(budget.hourly + budget.holder)
    }
    expect(budget.total).toBe(0)
  })

  it('bounds heavy background work while allowing failures without aborting the whole batch', async () => {
    let active = 0
    let maxActive = 0
    const tasks = Array.from({ length: 120 }, (_, index) => ({
      run: async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await new Promise<void>((resolve) => setTimeout(resolve, 1))
        active -= 1
        if (index % 17 === 0) throw new Error(`synthetic task failure ${index}`)
        return index
      },
    }))

    const results = await readHeavyUsing({}, tasks, { concurrency: 4 })
    expect(results).toHaveLength(120)
    expect(maxActive).toBe(4)
    expect(results.filter((result) => result.status === 'failure').length).toBe(8)
    expect(results.filter((result) => result.status === 'success').length).toBe(112)
  })
})
