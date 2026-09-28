export type RecyclePath = 'safeTransfer' | 'approveThenRecycle' | 'recycle'

export function recyclePath(count: number, operatorApproved: boolean): RecyclePath {
  if (count <= 0) throw new Error('pick at least one frame')
  if (count > 50) throw new Error('the Recycle Bin accepts at most 50 frames at once')
  if (operatorApproved) return 'recycle'
  return count === 1 ? 'safeTransfer' : 'approveThenRecycle'
}

export function binEligibleFrames<T extends { id: number; finale: boolean }>(frames: readonly T[]) {
  return frames.filter((frame) => frame.id !== 0 && !frame.finale)
}

export function cdEligibleFrames<T extends { id: number }>(frames: readonly T[]) {
  return frames.filter((frame) => frame.id !== 0)
}
