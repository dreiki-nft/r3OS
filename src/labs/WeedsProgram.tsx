import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { hexToBytes, type Address, type Hex } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { publicClient, wsClient } from '../chain/clients'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { R3TARDS_WEEDS_ABI } from '../lib/generated/abi'
import { getCanvasSnapshot, subscribeCanvas } from '../paint/canvasStore'
import { closeWindow } from '../os/windows'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { IntroBar } from '../os/ui/IntroBar'
import { MenuBar } from '../os/ui/MenuBar'
import { LabCanvas } from './LabCanvas'
import { errorText, labAddress } from './labCommon'
import { decodeWorldBitmap, patternPreviewCells, WEED_PATTERNS } from './weeds'

const RULES = [
  'the canvas is split into 16 regions. each one is its own 64 × 64 Life world that wraps at the edges.',
  'weeds only live on blank pixels. painting over them kills them, so busy areas stay clear.',
  'tick: advances one region by one generation. each region can tick once per block, by anyone.',
  'plant: drops a classic pattern (glider, acorn, diehard…) into a region. one plant per wallet every 100 blocks (~30 s).',
] as const

type Region = { generation: bigint; lastTickBlock: bigint; population: number }
const EMPTY_REGIONS = Array.from({ length: 16 }, () => ({ generation: 0n, lastTickBlock: 0n, population: 0 }))

export function WeedsProgram() {
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const canvas = useSyncExternalStore(subscribeCanvas, getCanvasSnapshot)
  const [address, setAddress] = useState<Address>()
  const [missing, setMissing] = useState(false)
  const [world, setWorld] = useState(new Uint8Array(65_536))
  const [regions, setRegions] = useState<Region[]>(EMPTY_REGIONS)
  const [lastPlantBlock, setLastPlantBlock] = useState(0n)
  const [plants, setPlants] = useState(0n)
  const [ticks, setTicks] = useState(0n)
  const [selectedRegion, setSelectedRegion] = useState(0)
  const [pattern, setPattern] = useState(0)
  const [plantAt, setPlantAt] = useState<{ x: number; y: number }>({ x: 28, y: 28 })
  const [plantQuote, setPlantQuote] = useState<ActionQuote>()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void labAddress('weeds')
      .then(setAddress)
      .catch(() => setMissing(true))
  }, [])

  const refresh = useCallback(async () => {
    if (!publicClient || !address) return
    const contracts: any[] = [
      { address, abi: R3TARDS_WEEDS_ABI, functionName: 'worldBitmap' },
      ...Array.from({ length: 16 }, (_, region) => ({
        address,
        abi: R3TARDS_WEEDS_ABI,
        functionName: 'regionInfo',
        args: [region],
      })),
    ]
    if (wallet.account)
      contracts.push({
        address,
        abi: R3TARDS_WEEDS_ABI,
        functionName: 'gardenerInfo',
        args: [wallet.account],
      })
    try {
      const result = await publicClient.multicall({ contracts, allowFailure: false })
      setWorld(decodeWorldBitmap(hexToBytes(result[0] as Hex)))
      setRegions(
        Array.from({ length: 16 }, (_, index) => {
          const info = result[index + 1] as any
          return { generation: BigInt(info[0]), lastTickBlock: BigInt(info[1]), population: Number(info[2]) }
        }),
      )
      if (wallet.account) {
        const gardener = result[17] as any
        setLastPlantBlock(BigInt(gardener[0]))
        setPlants(BigInt(gardener[1]))
        setTicks(BigInt(gardener[2]))
      }
    } catch (error) {
      setMessage(errorText(error))
    }
  }, [address, wallet.account])

  useEffect(() => {
    void refresh()
  }, [refresh, block.block])

  useEffect(() => {
    if (!wsClient || !address) return
    return wsClient.watchContractEvent({
      address,
      abi: R3TARDS_WEEDS_ABI,
      onLogs: () => void refresh(),
    })
  }, [address, refresh])

  const displayPixels = useMemo(() => {
    const out = canvas.background.slice()
    for (let index = 0; index < out.length; index++) {
      if (canvas.outline[index]) out[index] = canvas.face
      else if (out[index] === 0) out[index] = canvas.backgroundColor
    }
    return out
  }, [canvas.background, canvas.backgroundColor, canvas.face, canvas.outline])

  const weedOverlay = useMemo(() => {
    const out = world.slice()
    for (let index = 0; index < out.length; index++) {
      if (canvas.background[index] !== 0 || canvas.outline[index]) out[index] = 0
    }
    return out
  }, [world, canvas.background, canvas.outline])

  const localPreview = useMemo(() => patternPreviewCells(pattern, plantAt.x, plantAt.y), [pattern, plantAt])
  const previewGlobal = useMemo(() => {
    const ox = (selectedRegion & 3) * 64
    const oy = (selectedRegion >> 2) * 64
    return localPreview.map((cell) => ({ x: ox + cell.x, y: oy + cell.y }))
  }, [localPreview, selectedRegion])
  const cooldownUntil = lastPlantBlock === 0n ? 0n : lastPlantBlock + 100n
  const cooldown = cooldownUntil > block.block ? cooldownUntil - block.block : 0n

  useEffect(() => {
    setPlantQuote(undefined)
    if (!address || !wallet.account || cooldown > 0n) return
    let cancelled = false
    void quoteAction({
      kind: 'estimate',
      address,
      abi: R3TARDS_WEEDS_ABI,
      functionName: 'plant',
      args: [selectedRegion, plantAt.x, plantAt.y, pattern],
      account: wallet.account,
      action: `plant weeds in region ${selectedRegion}`,
      regions: [selectedRegion],
    })
      .then((q) => !cancelled && setPlantQuote(q))
      .catch(() => !cancelled && setPlantQuote(undefined))
    return () => {
      cancelled = true
    }
  }, [address, wallet.account, selectedRegion, plantAt, pattern, cooldown.toString()])

  async function quoteTick(region: number) {
    if (!address || !wallet.account) throw new Error('connect a wallet')
    return quoteAction({
      kind: 'estimate',
      address,
      abi: R3TARDS_WEEDS_ABI,
      functionName: 'tick',
      args: [region],
      account: wallet.account,
      action: `tick weeds region ${region}`,
      regions: [region],
    })
  }

  async function sendTick(region: number, quote: ActionQuote) {
    if (!address || !wallet.account) return
    await sendAction({
      kind: 'estimate',
      address,
      abi: R3TARDS_WEEDS_ABI,
      functionName: 'tick',
      args: [region],
      account: wallet.account,
      quote,
      action: `tick weeds region ${region}`,
      regions: [region],
      successSound: 'success-light',
      confirmHigherCost: async (_old, next) => window.confirm(`gas went up. continue with ${next.maxCost}?`),
    })
  }

  async function tick(region: number, all = false) {
    if (!address || !wallet.account || pending) return
    setPending(true)
    setMessage('')
    try {
      if (all) {
        const available = regions
          .map((info, index) => (info.lastTickBlock === block.block ? -1 : index))
          .filter((v) => v >= 0)
        if (!available.length) return
        const quoted = await Promise.all(
          available.map(async (next) => ({ region: next, quote: await quoteTick(next) })),
        )
        const costs = quoted.map((item) => `region ${item.region}: ${item.quote.maxCost}`).join('\n')
        if (!window.confirm(`tick ${available.length} regions as separate transactions?\n\n${costs}`)) return
        for (const item of quoted) await sendTick(item.region, item.quote)
      } else {
        const quote = await quoteTick(region)
        if (!window.confirm(`tick region ${region}?\n\n${quote.maxCost}`)) return
        await sendTick(region, quote)
      }
      await refresh()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setPending(false)
    }
  }

  async function plant() {
    if (!address || !wallet.account || !plantQuote || pending) return
    setPending(true)
    setMessage('')
    try {
      await sendAction({
        kind: 'estimate',
        address,
        abi: R3TARDS_WEEDS_ABI,
        functionName: 'plant',
        args: [selectedRegion, plantAt.x, plantAt.y, pattern],
        account: wallet.account,
        quote: plantQuote,
        action: `plant weeds in region ${selectedRegion}`,
        regions: [selectedRegion],
        successSound: 'success-light',
        confirmHigherCost: async (_old, next) =>
          window.confirm(`gas went up. continue with ${next.maxCost}?`),
      })
      await refresh()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setPending(false)
    }
  }

  const menus = [
    { label: 'File', items: [{ label: 'Close', action: () => closeWindow('weeds') }] },
    { label: 'View', items: [{ label: 'Refresh', action: refresh }] },
    { label: 'Help', items: [{ label: 'How it works', disabled: true }] },
  ]

  if (missing) return <div className="lab-missing">this Lab isn't deployed on this network</div>

  return (
    <div className="lab-program weeds-program">
      <MenuBar menus={menus} />
      <IntroBar
        lead="Conway's Game of Life, growing in the blank parts of the canvas. plant a pattern, then anyone can tick a region forward."
        monad="every generation is computed onchain. regions are separate state, so ticks in different regions run in parallel."
        rules={RULES}
        finalLine="plant 5 times or tick 25 times to earn the GARDENER stamp on your Pass."
      />
      <div className="weeds-main">
        <section className="weed-canvas-side">
          <GroupBox title="live canvas + weeds">
            <div
              className="lab-canvas-well sunken weed-map"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                const gx = Math.max(
                  0,
                  Math.min(255, Math.floor(((event.clientX - rect.left - 4) * 256) / (rect.width - 8))),
                )
                const gy = Math.max(
                  0,
                  Math.min(255, Math.floor(((event.clientY - rect.top - 4) * 256) / (rect.height - 8))),
                )
                const region = (gy >> 6) * 4 + (gx >> 6)
                setSelectedRegion(region)
                setPlantAt({ x: gx & 63, y: gy & 63 })
              }}
            >
              <LabCanvas
                size={256}
                pixels={displayPixels}
                overlay={weedOverlay}
                previewCells={previewGlobal}
                zoom={1.72}
              />
              <div className="weed-region-lines" />
            </div>
          </GroupBox>
          <div className="weed-note">
            click the canvas to choose a region and pattern origin. placement wraps inside that 64 × 64
            region.
          </div>
        </section>
        <section className="weeds-controls">
          <GroupBox title="16 regions">
            <div className="weed-regions">
              {regions.map((info, region) => (
                <div
                  key={region}
                  className={selectedRegion === region ? 'selected' : ''}
                  onClick={() => setSelectedRegion(region)}
                >
                  <b>region {region}</b>
                  <span>
                    {info.population} cells · gen {info.generation.toString()}
                  </span>
                  <Button
                    disabled={pending || !wallet.account || info.lastTickBlock === block.block}
                    title={
                      info.lastTickBlock === block.block
                        ? 'already ticked this block'
                        : 'Shift-click to tick every available region'
                    }
                    onClick={(event) => {
                      event.stopPropagation()
                      void tick(region, event.shiftKey)
                    }}
                  >
                    Tick
                  </Button>
                </div>
              ))}
            </div>
          </GroupBox>
          <GroupBox title="Plant">
            <label className="lab-field">
              pattern{' '}
              <select value={pattern} onChange={(event) => setPattern(Number(event.target.value))}>
                {WEED_PATTERNS.map((name, index) => (
                  <option key={name} value={index}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <div>
              region {selectedRegion} · x {plantAt.x} · y {plantAt.y}
            </div>
            <div className="weed-pattern-preview sunken">
              <LabCanvas size={64} pixels={new Uint8Array(4096)} previewCells={localPreview} zoom={2} />
            </div>
            <div className="lab-action-row">
              <Button
                primary
                disabled={pending || !plantQuote || cooldown > 0n}
                title={cooldown > 0n ? `cooldown until block ${cooldownUntil}` : 'plant'}
                onClick={plant}
              >
                Plant pattern
              </Button>
              <small>
                {cooldown > 0n
                  ? `${cooldown} blocks · ~${Math.ceil((Number(cooldown) * block.blockTimeMs) / 1000)} s`
                  : (plantQuote?.maxCost ?? 'quoting…')}
              </small>
            </div>
          </GroupBox>
          <GroupBox title="GARDENER stamp">
            <div>
              plants {plants.toString()} / 5 · ticks {ticks.toString()} / 25
            </div>
            <progress
              max={100}
              value={Number(
                plants >= 5n || ticks >= 25n ? 100n : plants * 20n > ticks * 4n ? plants * 20n : ticks * 4n,
              )}
            />
          </GroupBox>
        </section>
      </div>
      <footer className="lab-status">
        <span>
          {message ||
            'weeds live only on blank canvas pixels · Shift-click Tick to tick all available regions'}
        </span>
        <span>region {selectedRegion}</span>
        <span>#{block.block.toString()}</span>
      </footer>
    </div>
  )
}
