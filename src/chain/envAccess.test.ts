import { describe, expect, it } from 'vitest'

const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('env access', () => {
  it('reads import.meta.env only by literal names, so Vite never inlines the whole env into the bundle', () => {
    // `import.meta.env[name]` or `import.meta.env as …` makes Vite embed every VITE_ variable (including
    // Vercel's VITE_VERCEL_* deployment details) in the public JavaScript.
    expect(Object.keys(sources).length).toBeGreaterThan(100)
    const offenders = Object.entries(sources)
      .filter(([file]) => !/\.test\.tsx?$/.test(file))
      .filter(([, source]) => /import\.meta\.env\s*(\[|as\b|\)|,|;|$)/m.test(source))
      .map(([file]) => file)
    expect(offenders).toEqual([])
  })
})
