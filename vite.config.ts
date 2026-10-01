import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Long-lived vendor chunks: stable across app deploys, so returning visitors only re-download app code. */
const VENDOR_CHUNKS: Array<[string, RegExp]> = [
  ['vendor-react', /\/node_modules\/(react|react-dom|scheduler)\//],
  ['vendor-chain', /\/node_modules\/(viem|ox|abitype|isows|@noble|@scure|@adraffy)\//],
]

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          for (const [name, pattern] of VENDOR_CHUNKS) if (pattern.test(id)) return name
          return undefined
        },
      },
    },
  },
})
