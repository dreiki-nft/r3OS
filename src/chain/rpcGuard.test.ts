import { describe, expect, it } from 'vitest'

const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function compact(source: string) {
  return source.replace(/\s+/g, ' ')
}

describe('RPC source guard', () => {
  it('actually sees the source tree', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100)
    expect(sources['/src/chain/logs.ts']).toContain('.getLogs(')
  })

  it('centralizes getLogs in chain/logs.ts', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => path !== '/src/chain/logs.ts' && path !== '/src/chain/rpcGuard.test.ts')
      .filter(([, source]) => source.includes('.getLogs('))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('never scans logs from block zero', () => {
    const pattern = /fromBlock\s*:\s*0n/
    const offenders = Object.entries(sources)
      .filter(([path]) => path !== '/src/chain/rpcGuard.test.ts')
      .filter(([, source]) => pattern.test(source))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('never passes latest directly to a getLogs call', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => path !== '/src/chain/logs.ts' && path !== '/src/chain/rpcGuard.test.ts')
      .filter(([, source]) => {
        const text = compact(source)
        return text.includes('.getLogs(') && /toBlock\s*:\s*['\"]latest['\"]/.test(text)
      })
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('keeps the nostalgic shell layer on existing stores instead of adding RPC loops', () => {
    const nostalgicFiles = [
      '/src/os/ActivityHost.tsx',
      '/src/os/DisplayProperties.tsx',
      '/src/os/FloppyDialog.tsx',
      '/src/os/ScreensaverOverlay.tsx',
      '/src/os/WallpaperLayer.tsx',
      '/src/os/activity.ts',
      '/src/os/imageResources.ts',
      '/src/os/wallpaper.ts',
      '/src/monadhw/blockPlayer.ts',
    ]
    const forbidden = [
      "../chain/clients",
      "../chain/logs",
      "../chain/readMany",
      "../chain/refreshTick",
      '.getLogs(',
      '.readContract(',
      '.multicall(',
    ]
    const offenders: string[] = []
    for (const path of nostalgicFiles) {
      const source = sources[path]
      expect(source, path).toBeTypeOf('string')
      if (forbidden.some((needle) => source.includes(needle))) offenders.push(path)
    }
    expect(offenders).toEqual([])
  })

})
