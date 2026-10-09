import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Several tests dynamically import the wallet/chain module graph. On a busy Windows machine with
    // 8 workers that first import alone can take 5-7 s, which is not a bug; real hangs still fail at 30 s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
