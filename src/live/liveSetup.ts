/**
 * Live Mode work in this tab that the automatic sweep must not race:
 * - a setup (Quick Start), while a burner can hold fresh funding for a session that hasn't started yet;
 * - an End session (Hardware Profiles or the disconnect prompt), which revokes and then sweeps by itself.
 * And the other way round: an End session waits for an automatic sweep that is already sending.
 */
let running = 0
let sweeping: Promise<unknown> | undefined

export function liveSetupRunning() {
  return running > 0
}

/** Runs `task` with the automatic sweep held off (Quick Start, End session). */
export async function duringLiveSetup<T>(task: () => Promise<T>): Promise<T> {
  running += 1
  try {
    return await task()
  } finally {
    running -= 1
  }
}

/** The automatic sweep registers its transfer here while it is in flight. */
export function trackAutoSweep<T>(task: Promise<T>): Promise<T> {
  sweeping = task
  const clear = () => {
    if (sweeping === task) sweeping = undefined
  }
  task.then(clear, clear)
  return task
}

/** Resolves once no automatic sweep is in flight (never rejects). */
export async function autoSweepSettled() {
  await sweeping?.catch(() => undefined)
}
