import { afterEach, describe, expect, it } from 'vitest'
import { answerConfirm, confirmHigherCost, getConfirm, osConfirm, resetConfirmForTest } from './confirm'

afterEach(() => resetConfirmForTest())

describe('osConfirm', () => {
  it('resolves true on OK and false on cancel, one request at a time', async () => {
    const first = osConfirm({ message: 'first?' })
    const second = osConfirm({ message: 'second?', title: 'Two' })
    expect(getConfirm()?.message).toBe('first?')

    answerConfirm(getConfirm()!.id, true)
    await expect(first).resolves.toBe(true)
    expect(getConfirm()?.title).toBe('Two')

    answerConfirm(getConfirm()!.id, false)
    await expect(second).resolves.toBe(false)
    expect(getConfirm()).toBeUndefined()
  })

  it('ignores a second answer for the same request (OK then close)', async () => {
    const pending = osConfirm({ message: 'once?' })
    const id = getConfirm()!.id
    answerConfirm(id, true)
    answerConfirm(id, false)
    await expect(pending).resolves.toBe(true)
  })

  it('shows both quoted costs when gas goes up', () => {
    void confirmHigherCost({ maxCost: '0.01 MON' }, { maxCost: '0.02 MON' })
    const request = getConfirm()!
    expect(request.title).toBe('Gas went up')
    expect(request.message).toContain('was 0.01 MON')
    expect(request.message).toContain('now 0.02 MON')
  })
})
