/**
 * Whether a Live Mode setup (Quick Start) is running in this tab. While it is, a burner can hold fresh funding
 * for a session that hasn't started yet, so the automatic sweep must leave it alone.
 */
let running = 0

export function liveSetupRunning() {
  return running > 0
}

export async function duringLiveSetup<T>(task: () => Promise<T>): Promise<T> {
  running += 1
  try {
    return await task()
  } finally {
    running -= 1
  }
}
