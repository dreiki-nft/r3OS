import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  discoverContracts: vi.fn(),
  resolveHolderIds: vi.fn(),
  readMany: vi.fn(),
}))

vi.mock('../chain/clients', () => ({ publicClient: {} }))
vi.mock('../chain/config', () => ({
  config: {
    chainId: 10_143,
    paintAddress: '0x00000000000000000000000000000000000000aa',
  },
}))
vi.mock('../chain/contracts', () => ({ discoverContracts: mocks.discoverContracts }))
vi.mock('../chain/holders', () => ({ resolveHolderIds: mocks.resolveHolderIds }))
vi.mock('../chain/readMany', () => ({ readMany: mocks.readMany }))

const owner = '0x0000000000000000000000000000000000000001'
const pass = '0x0000000000000000000000000000000000000002'
const collection = '0x0000000000000000000000000000000000000003'

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.discoverContracts.mockResolvedValue({ pass, r3tards: collection })
  mocks.readMany.mockResolvedValue([7n, true])
  mocks.resolveHolderIds.mockResolvedValue([11n, 12n])
  const { __resetPassIdentityForTests } = await import('./passData')
  __resetPassIdentityForTests()
})

describe('Painter Pass identity loading', () => {
  it('makes core identity available without waiting for holder-token discovery', async () => {
    const { readPassCoreIdentity } = await import('./passData')
    await expect(readPassCoreIdentity(owner)).resolves.toMatchObject({
      passAddress: pass,
      collection,
      passId: 7n,
      hasClaimed: true,
    })
    expect(mocks.resolveHolderIds).not.toHaveBeenCalled()
  })

  it('keeps holder-token discovery in the full background identity path', async () => {
    const { readPassIdentity } = await import('./passData')
    await expect(readPassIdentity(owner)).resolves.toMatchObject({
      passId: 7n,
      hasClaimed: true,
      holderIds: [11n, 12n],
    })
    expect(mocks.resolveHolderIds).toHaveBeenCalledTimes(1)
  })
})
