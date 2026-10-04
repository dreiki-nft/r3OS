import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Link previews (X, Telegram, Discord) need an absolute og:image URL. Set VITE_SITE_URL (e.g.
 * https://r3os.example); on Vercel the production domain is used automatically. Otherwise the path stays
 * relative, which still works for most previewers. Public URL only: never a secret.
 */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}

function siteUrl() {
  const explicit = env.VITE_SITE_URL?.trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  return vercel ? `https://${vercel}` : ''
}

const socialMeta = (): Plugin => ({
  name: 'r3os-social-meta',
  transformIndexHtml: (html) => html.split('__SITE_URL__').join(siteUrl()),
})

/** Long-lived vendor chunks: stable across app deploys, so returning visitors only re-download app code. */
const VENDOR_CHUNKS: Array<[string, RegExp]> = [
  ['vendor-react', /\/node_modules\/(react|react-dom|scheduler)\//],
  ['vendor-chain', /\/node_modules\/(viem|ox|abitype|isows|@noble|@scure|@adraffy)\//],
]

export default defineConfig({
  plugins: [react(), socialMeta()],
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
