import { helpHash } from '../os/helpTopics'
import { screenSafeMessage } from '../chain/errors'
import { safeRouteInt } from '../lib/route'
import { requestRecycle } from '../os/programs/recycleIntent'
import './frames.css'
import { confirmHigherCost } from '../os/confirm'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react'
import { type Address } from 'viem'
import { publicClient } from '../chain/clients'
import { readMany } from '../chain/readMany'
import { useRefreshTick } from '../chain/refreshTick'
import { config } from '../chain/config'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { R3TARDS_PAINT_ABI } from '../lib/generated/abi'
import { openProgram } from '../os/programs'
import { playSound } from '../os/sound'
import { closeWindow } from '../os/windows'
import { Button } from '../os/ui/Button'
import type { IconName } from '../os/icons'
import { Icon } from '../os/ui/Icon'
import { MenuBar } from '../os/ui/MenuBar'
import { MessageBox } from '../os/ui/MessageBox'
import {
  getFrameImage,
  getOnchainDf1,
  getSiteDf1,
  paletteLabel,
  rendererList,
  tokenRenderer,
  type PixelImage,
  type RendererInfo,
} from './frameImage'
import {
  finaleIds,
  getFrameInfo,
  getFrameInfoBatch,
  getFramesSnapshot,
  hiddenFrameIds,
  hideFrame,
  isFrameHidden,
  mineTokenIds,
  pageNewestFirst,
  refreshFrameIndex,
  restoreFrame,
  seasonSummary,
  seasonTokenIds,
  subscribeFrames,
  type FrameInfo,
  type SeasonSummary,
} from './framesStore'
import { PixelPreview } from './PixelPreview'
import { LabsFolder } from './LabsFolder'
import { finaleEligibility } from './finale'

const FILTERS = ['Mine', 'All frames', 'Finales', 'Hidden'] as const
type Filter = (typeof FILTERS)[number]
type PreviewMode = 'frame' | 'DF1 onchain' | 'DF1 site'

type FinaleReadyRow = {
  season: number
  endsAt: bigint
  recipient: Address
  canMint: boolean
  authorized: boolean
  publicOpen: boolean
  holderWindowEnds: bigint
  quote?: ActionQuote
  ready: boolean
}

function short(address?: string | null) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—'
}

function routeParams() {
  return new URLSearchParams(location.hash.split('?')[1] ?? '')
}

async function readOwner(tokenId: number) {
  if (!publicClient || !config.paintAddress) return undefined
  try {
    return (await publicClient.readContract({
      address: config.paintAddress,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'ownerOf',
      args: [BigInt(tokenId)],
    })) as Address
  } catch {
    return null
  }
}

function FrameTile({
  tokenId,
  info,
  selected,
  hidden,
  list,
  onSelect,
  onOpen,
  onContextMenu,
}: {
  tokenId: number
  info?: FrameInfo
  selected: boolean
  hidden: boolean
  list: boolean
  onSelect: () => void
  onOpen: () => void
  onContextMenu: (x: number, y: number) => void
}) {
  const root = useRef<HTMLButtonElement>(null)
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  const [image, setImage] = useState<PixelImage>()

  useEffect(() => {
    const element = root.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    void getFrameImage(tokenId)
      .then((next) => {
        if (!cancelled) setImage(next)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [visible, tokenId])

  return (
    <button
      ref={root}
      className={[
        'frame-cell',
        selected ? 'selected' : '',
        hidden ? 'hidden-frame' : '',
        list ? 'list' : '',
      ].join(' ')}
      draggable={tokenId > 0}
      onDragStart={(event) => {
        if (tokenId > 0) event.dataTransfer.setData('application/x-r3-frame', String(tokenId))
      }}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={(event) => {
        event.preventDefault()
        onSelect()
        onContextMenu(event.clientX, event.clientY)
      }}
    >
      <div className="frame-thumb" aria-hidden={!visible}>
        {visible && <PixelPreview image={image} size={list ? 52 : 148} />}
        {info?.df1Amount != null && info.df1Amount >= 200 && <b className="frame-tag">STORM</b>}
        {info?.finale && <b className="frame-tag finale">FINALE</b>}
      </div>
      <span>{tokenId === 0 ? 'live canvas' : `frame #${tokenId}`}</span>
      {list && info && <small>season {info.season + 1}</small>}
    </button>
  )
}

function SeasonFolder({
  season,
  count,
  onOpen,
}: {
  season: SeasonSummary
  count: number
  onOpen: () => void
}) {
  return (
    <button className="season-folder" onDoubleClick={onOpen} onClick={onOpen}>
      <Icon name="gallery" size={36} colour="#EE93E3" />
      <b>season {season.season + 1}</b>
      <small>{count} frames</small>
    </button>
  )
}

export function FramesProgram() {
  const refreshTick = useRefreshTick()
  const [routeVersion, setRouteVersion] = useState(0)
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const frames = useSyncExternalStore(subscribeFrames, getFramesSnapshot)
  const params = useMemo(() => {
    void routeVersion
    return routeParams()
  }, [routeVersion])
  const routeFrame = safeRouteInt(params.get('frame'))
  const routeSeason = params.get('season')
  const [filter, setFilter] = useState<Filter>(() => {
    const requested = params.get('filter')
    return requested === 'Finales' || requested === 'All frames' || requested === 'Hidden'
      ? requested
      : 'Mine'
  })
  const [labsView, setLabsView] = useState(params.get('labs') === '1')
  const [season, setSeason] = useState<number | undefined>(
    routeSeason == null || !/^\d{1,6}$/.test(routeSeason) ? undefined : Number(routeSeason),
  )
  const [history, setHistory] = useState<(number | undefined)[]>([])
  const [ids, setIds] = useState<number[]>([])
  const [mineIds, setMineIds] = useState<number[]>([])
  const [mineFor, setMineFor] = useState<string>()
  const [infos, setInfos] = useState(new Map<number, FrameInfo>())
  const [selected, setSelected] = useState<number | undefined>(routeFrame || undefined)
  const [selectedInfo, setSelectedInfo] = useState<FrameInfo>()
  const [selectedOwner, setSelectedOwner] = useState<Address | null>()
  const [selectedRenderer, setSelectedRenderer] = useState('built-in (0)')
  const [renderers, setRenderers] = useState<RendererInfo[]>([])
  const [contextMenu, setContextMenu] = useState<{ tokenId: number; x: number; y: number }>()
  const [previewMode, setPreviewMode] = useState<PreviewMode>('frame')
  const [preview, setPreview] = useState<PixelImage>()
  const [page, setPage] = useState(1)
  const [view, setView] = useState<'large' | 'list'>('large')
  const [burnQuote, setBurnQuote] = useState<ActionQuote>()
  const [burnPrompt, setBurnPrompt] = useState(false)
  const [box, setBox] = useState<{ title: string; message: string; kind?: 'error' | 'warning' | 'info' }>()
  const [finaleReady, setFinaleReady] = useState<FinaleReadyRow[]>([])
  const [finaleMinting, setFinaleMinting] = useState<number>()
  const sentinel = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void refreshFrameIndex()
  }, [])

  useEffect(() => {
    if (!publicClient || !config.paintAddress) return
    const client = publicClient
    let cancelled = false
    void (async () => {
      const latestSeason = frames.currentSeason
      const seasons = [latestSeason - 1, latestSeason - 2, latestSeason - 3].filter((value) => value >= 0)
      if (!seasons.length) {
        if (!cancelled) setFinaleReady([])
        return
      }
      const owner = (await client.readContract({
        address: config.paintAddress!,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'ownerOf',
        args: [0n],
      })) as Address
      const calls: any[] = [
        { address: config.paintAddress!, abi: R3TARDS_PAINT_ABI, functionName: 'getApproved', args: [0n] },
        ...seasons.map((season) => ({
          address: config.paintAddress!,
          abi: R3TARDS_PAINT_ABI,
          functionName: 'seasonInfo',
          args: [BigInt(season)],
        })),
      ]
      if (wallet.account)
        calls.push({
          address: config.paintAddress!,
          abi: R3TARDS_PAINT_ABI,
          functionName: 'isApprovedForAll',
          args: [owner, wallet.account],
        })
      const values = (await readMany(calls, { allowFailure: false })) as any[]
      const approved = values[0] as Address
      const operatorApproved = wallet.account ? Boolean(values.at(-1)) : false
      const latest = (await client.getBlock({ blockTag: 'latest', includeTransactions: false })) as {
        timestamp: bigint
      }
      const rows: FinaleReadyRow[] = []
      for (let index = 0; index < seasons.length; index++) {
        const season = seasons[index]
        const info = values[index + 1] as any
        const endsAt = BigInt(info.endsAt ?? info[1])
        const finaleMinted = Boolean(info.finaleMinted ?? info[5])
        const successfulPaints = BigInt(info.successfulPaints ?? info[7])
        const eligibility = finaleEligibility({
          endsAt,
          successfulPaints,
          finaleMinted,
          now: latest.timestamp,
          account: wallet.account,
          tokenZeroOwner: owner,
          approved,
          operatorApproved,
        })
        if (!eligibility.ready) continue
        let quote: ActionQuote | undefined
        if (eligibility.canMint && wallet.account) {
          quote = await quoteAction({
            kind: 'estimate',
            address: config.paintAddress!,
            abi: R3TARDS_PAINT_ABI,
            functionName: 'mintSeasonFinale',
            args: [BigInt(season)],
            account: wallet.account,
            action: `mint season ${season + 1} finale`,
          }).catch(() => undefined)
        }
        rows.push({ season, endsAt, recipient: owner, quote, ...eligibility })
      }
      if (!cancelled) setFinaleReady(rows)
    })().catch(() => {
      if (!cancelled) setFinaleReady([])
    })
    return () => {
      cancelled = true
    }
  }, [frames.currentSeason, wallet.account, refreshTick])

  useEffect(() => {
    const route = () => setRouteVersion((value) => value + 1)
    window.addEventListener('hashchange', route)
    return () => window.removeEventListener('hashchange', route)
  }, [])

  useEffect(() => {
    if (routeSeason != null && /^\d{1,6}$/.test(routeSeason)) setSeason(Number(routeSeason))
    if (routeFrame > 0) setSelected(routeFrame)
    setLabsView(params.get('labs') === '1')
  }, [routeSeason, routeFrame, params])

  const loadMine = useCallback(async () => {
    if (!wallet.account) {
      setMineIds([])
      return
    }
    await refreshFrameIndex()
    setMineIds(await mineTokenIds(wallet.account))
    setMineFor(wallet.account)
  }, [wallet.account, frames.total])

  useEffect(() => {
    if (filter === 'Mine') void loadMine()
  }, [filter, loadMine, frames.version])

  useEffect(() => {
    if (!routeFrame || season != null) return
    void getFrameInfo(routeFrame).then((info) => {
      if (info) setSeason(info.season)
    })
  }, [routeFrame, season])

  const loadIds = useCallback(async () => {
    if (filter === 'Finales') {
      setIds(finaleIds())
      return
    }
    if (filter === 'Hidden') {
      setIds(hiddenFrameIds())
      return
    }
    if (season == null) {
      setIds([])
      return
    }
    const summary = seasonSummary(season)
    if (!summary) {
      setIds([])
      return
    }
    const seasonIds = (await seasonTokenIds(summary)).filter((id) => !isFrameHidden(id))
    setIds(filter === 'Mine' ? seasonIds.filter((id) => mineIds.includes(id)) : seasonIds)
  }, [filter, season, mineIds, frames.version])

  useEffect(() => {
    setPage(1)
    void loadIds()
  }, [loadIds])

  const visibleIds = useMemo(() => pageNewestFirst(ids, page), [ids, page])

  useEffect(() => {
    if (!visibleIds.length) return
    void getFrameInfoBatch(visibleIds.filter((id) => id > 0)).then((next) => {
      setInfos((current) => new Map([...current, ...next]))
    })
  }, [visibleIds.join(',')])

  useEffect(() => {
    const element = sentinel.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && page * 24 < ids.length) {
        setPage((value) => value + 1)
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ids.length, page])

  useEffect(() => {
    if (selected == null) {
      setSelectedInfo(undefined)
      setSelectedOwner(undefined)
      setPreview(undefined)
      return
    }
    let cancelled = false
    void Promise.all([
      selected === 0 ? Promise.resolve(undefined) : getFrameInfo(selected),
      readOwner(selected),
      getFrameImage(selected),
      selected === 0 ? Promise.resolve(0) : tokenRenderer(selected).catch(() => 0),
      rendererList(),
    ]).then(([info, owner, image, rendererId, renderers]) => {
      if (cancelled) return
      setSelectedInfo(info)
      setSelectedOwner(owner)
      setPreview(image)
      setRenderers(renderers)
      const renderer = renderers.find((item) => item.id === rendererId)
      setSelectedRenderer(`${renderer?.name ?? 'built-in'} (${rendererId})`)
    })
    return () => {
      cancelled = true
    }
  }, [selected, frames.version])

  useEffect(() => {
    if (selected == null) return
    let cancelled = false
    const load =
      previewMode === 'frame'
        ? getFrameImage(selected)
        : selected === 0
          ? Promise.reject(new Error('live canvas DF1 disabled'))
          : previewMode === 'DF1 onchain'
            ? getOnchainDf1(selected)
            : getSiteDf1(selected)
    void load
      .then((image) => {
        if (!cancelled) setPreview(image)
      })
      .catch(() => {
        if (!cancelled && selected === 0) setPreviewMode('frame')
      })
    return () => {
      cancelled = true
    }
  }, [selected, previewMode])

  useEffect(() => {
    if (!contextMenu) return
    const outside = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(undefined)
    }
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(undefined)
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', key)
    }
  }, [contextMenu])

  const ownsSelected = Boolean(
    wallet.account && selectedOwner && wallet.account.toLowerCase() === selectedOwner.toLowerCase(),
  )

  useEffect(() => {
    if (
      selected == null ||
      selected === 0 ||
      selectedInfo?.finale ||
      !ownsSelected ||
      !wallet.account ||
      !config.paintAddress
    ) {
      setBurnQuote(undefined)
      return
    }
    let cancelled = false
    void quoteAction({
      kind: 'estimate',
      address: config.paintAddress,
      abi: R3TARDS_PAINT_ABI,
      functionName: 'burn',
      args: [BigInt(selected)],
      account: wallet.account,
      action: `burn frame #${selected}`,
    })
      .then((quote) => {
        if (!cancelled) setBurnQuote(quote)
      })
      .catch(() => {
        if (!cancelled) setBurnQuote(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [selected, selectedInfo, ownsSelected, wallet.account])

  const mineSeasonCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const id of mineIds) {
      if (id === 0) continue
      const info = infos.get(id)
      if (info) counts.set(info.season, (counts.get(info.season) ?? 0) + 1)
    }
    return counts
  }, [mineIds, infos])

  useEffect(() => {
    if (filter !== 'Mine' || !mineIds.length) return
    const missing = mineIds.filter((id) => id > 0 && !infos.has(id))
    if (!missing.length) return
    void getFrameInfoBatch(missing).then((next) => setInfos((current) => new Map([...current, ...next])))
  }, [filter, mineIds, infos])

  const navigateSeason = (next: number | undefined) => {
    setHistory((current) => [...current, season])
    setSeason(next)
    setSelected(undefined)
  }

  const goBack = () => {
    if (!history.length) return
    const next = history.slice(0, -1)
    const target = history[history.length - 1]
    setHistory(next)
    setSeason(target)
    setSelected(undefined)
  }

  const openTokenProps = (tokenId: number, tab = 'General', renderer?: string) => {
    if (tokenId === 0) return
    const query = new URLSearchParams({ token: String(tokenId), tab })
    if (renderer) query.set('renderer', renderer)
    openProgram('frame-props', true, `#/frame-props?${query}`)
  }

  const openProps = (tab = 'General', renderer?: string) => {
    if (selected == null) return
    openTokenProps(selected, tab, renderer)
  }

  const openContextMenu = (tokenId: number, x: number, y: number) => {
    if (tokenId !== selected) {
      setSelected(tokenId)
      setSelectedInfo(tokenId > 0 ? infos.get(tokenId) : undefined)
      setSelectedOwner(undefined)
    }
    const maxX = typeof innerWidth === 'number' ? Math.max(0, innerWidth - 430) : x
    const maxY = typeof innerHeight === 'number' ? Math.max(0, innerHeight - 260) : y
    setContextMenu({ tokenId, x: Math.min(x, maxX), y: Math.min(y, maxY) })
  }

  const cycleDf1 = () => {
    if (selected == null || selected === 0) return
    setPreviewMode((current) =>
      current === 'frame' ? 'DF1 onchain' : current === 'DF1 onchain' ? 'DF1 site' : 'frame',
    )
  }

  async function burnSelected() {
    if (!wallet.account || selected == null || !burnQuote || !config.paintAddress) return
    try {
      await sendAction({
        kind: 'estimate',
        address: config.paintAddress,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'burn',
        args: [BigInt(selected)],
        account: wallet.account,
        quote: burnQuote,
        action: `burn frame #${selected}`,
        successSound: 'success-light',
        confirmHigherCost,
      })
      setBurnPrompt(false)
      setSelected(undefined)
      if (filter === 'Mine') await loadMine()
      await loadIds()
    } catch (error) {
      setBox({
        title: 'Burn failed',
        message: screenSafeMessage(error),
        kind: 'error',
      })
    }
  }

  const currentObjects =
    season == null && (filter === 'Mine' || filter === 'All frames')
      ? frames.seasons.filter((item) => item.count > 0).length +
        (filter === 'Mine' && mineIds.includes(0) ? 1 : 0)
      : ids.length

  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('input, select, textarea, button')) return
    if (event.key === 'Backspace' && season != null) {
      event.preventDefault()
      navigateSeason(undefined)
      return
    }
    if (
      event.key === 'Delete' &&
      selected != null &&
      selected !== 0 &&
      !selectedInfo?.finale &&
      ownsSelected
    ) {
      event.preventDefault()
      recycleFrame(Number(selected))
      return
    }
    if (event.altKey && event.key === 'Enter' && selected != null && selected !== 0) {
      event.preventDefault()
      openProps()
      return
    }
    if (event.key === 'Enter' && selected != null && selected !== 0) {
      event.preventDefault()
      openProps()
      return
    }
    if (!visibleIds.length) return
    const current = selected == null ? -1 : visibleIds.indexOf(selected)
    const columns = view === 'large' ? 4 : 1
    let next = current
    if (event.key === 'ArrowRight') next = Math.min(visibleIds.length - 1, current + 1)
    if (event.key === 'ArrowLeft') next = Math.max(0, current - 1)
    if (event.key === 'ArrowDown') next = Math.min(visibleIds.length - 1, current + columns)
    if (event.key === 'ArrowUp') next = Math.max(0, current - columns)
    if (next !== current && next >= 0) setSelected(visibleIds[next])
  }

  const rootView = !labsView && season == null && (filter === 'Mine' || filter === 'All frames')
  const selectedRegular = selected != null && selected > 0 && selectedInfo && !selectedInfo.finale
  const toolbar: {
    label: string
    icon?: IconName | null
    colour?: string
    enabled: boolean
    reason: string
    action: () => void
    glyph?: string
  }[] = [
    {
      label: 'Back',
      icon: null,
      enabled: history.length > 0,
      reason: 'no navigation history',
      action: goBack,
      glyph: '←',
    },
    {
      label: 'Up',
      icon: null,
      enabled: season != null,
      reason: 'already at My Frames',
      action: () => navigateSeason(undefined),
      glyph: '↑',
    },
    {
      label: 'Renderer',
      icon: 'wand' as const,
      enabled: selected != null && selected > 0,
      reason: 'select a saved frame',
      action: () => openProps('Renderer'),
    },
    {
      label: 'DF1 view',
      icon: 'eye' as const,
      enabled: selected != null && selected > 0,
      reason: 'select a saved frame',
      action: cycleDf1,
    },
    {
      label: 'Timelapse',
      icon: 'layers' as const,
      enabled: Boolean(selectedInfo?.finale),
      reason: 'finales only',
      action: () => openProps('Renderer', 'season timelapse'),
    },
    {
      label: 'Restore',
      icon: 'brush' as const,
      enabled: filter === 'Hidden' && selected != null && frames.flagged.has(selected),
      reason: 'select a hidden frame',
      action: () => {
        if (selected != null) restoreFrame(selected)
      },
    },
    {
      label: 'Burn CD',
      icon: 'disc' as const,
      enabled: Boolean(wallet.account),
      reason: 'connect a wallet to burn your frames onto a CD',
      action: () =>
        openProgram('cd', true, selectedRegular && ownsSelected ? `#/cd?frame=${selected}` : '#/cd'),
    },
    {
      label: 'List',
      icon: 'gavel' as const,
      enabled: Boolean(selectedInfo?.finale && ownsSelected),
      reason: 'select a finale you own',
      action: () => openProgram('auction', true, `#/auction?token=${selected}`),
    },
  ]

  async function mintFinale(row: FinaleReadyRow) {
    if (!wallet.account || !config.paintAddress || !row.quote) return
    setFinaleMinting(row.season)
    try {
      await sendAction({
        kind: 'estimate',
        address: config.paintAddress,
        abi: R3TARDS_PAINT_ABI,
        functionName: 'mintSeasonFinale',
        args: [BigInt(row.season)],
        account: wallet.account,
        quote: row.quote,
        action: `mint season ${row.season + 1} finale`,
        successSound: 'success-heavy',
      })
      await refreshFrameIndex()
    } catch (error) {
      setBox({
        title: 'Mint finale',
        message: screenSafeMessage(error),
        kind: 'error',
      })
    } finally {
      setFinaleMinting(undefined)
    }
  }

  const menus: Parameters<typeof MenuBar>[0]['menus'] = [
    { label: 'File', items: [{ label: 'Close', action: () => closeWindow('frames') }] },
    {
      label: 'Edit',
      items: [{ label: 'Select all', disabled: true, disabledReason: 'not needed here' }],
    },
    {
      label: 'View',
      items: [
        { label: `Large icons ${view === 'large' ? '✓' : ''}`, action: () => setView('large') },
        { label: `List ${view === 'list' ? '✓' : ''}`, action: () => setView('list') },
      ],
    },
    {
      label: 'Go',
      items: [
        { label: 'Back', disabled: !history.length, disabledReason: 'no history', action: goBack },
        {
          label: 'Up',
          disabled: season == null,
          disabledReason: 'already at My Frames',
          action: () => navigateSeason(undefined),
        },
      ],
    },
    {
      label: 'Favorites',
      items: [{ label: 'Add to Favorites', disabled: true, disabledReason: 'favorites are coming later' }],
    },
    {
      label: 'Help',
      items: [{ label: 'Help Topics', action: () => openProgram('help', true, helpHash('frames')) }],
    },
  ]

  return (
    <div className="frames-program" tabIndex={0} onKeyDown={keyboard}>
      <MenuBar menus={menus} />
      <div className="frames-toolbar raised">
        {toolbar.map((item, index) => (
          <button
            key={item.label}
            className={index === 2 || index === 5 ? 'after-separator' : ''}
            disabled={!item.enabled}
            title={!item.enabled ? item.reason : item.label}
            onClick={() => {
              item.action()
              playSound('select')
            }}
          >
            {item.icon ? (
              <Icon name={item.icon} size={24} colour={item.colour} />
            ) : (
              <b className="toolbar-glyph">{item.glyph ?? '·'}</b>
            )}
            <span>{item.label}</span>
          </button>
        ))}
        {selectedRegular && ownsSelected && (
          <button
            className="frames-burn"
            title="send this frame to the Recycle Bin"
            onClick={() => recycleFrame(Number(selected))}
          >
            <Icon name="trash" size={24} colour="#877549" />
            <span>Recycle</span>
          </button>
        )}
      </div>
      <div className="frames-address-row">
        <div className="frames-address sunken">
          <Icon name="gallery" size={20} colour="#EE93E3" />
          <span>
            {labsView
              ? 'My Frames › Labs'
              : season == null
                ? 'My Frames'
                : `My Frames › season ${season + 1}`}
          </span>
        </div>
        <div className="frame-filters">
          {FILTERS.map((item) => (
            <button
              key={item}
              className={filter === item ? 'active' : ''}
              onClick={() => {
                setFilter(item)
                setLabsView(false)
                setSeason(undefined)
                setSelected(undefined)
                setHistory([])
              }}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      {labsView ? (
        <LabsFolder onExit={() => setLabsView(false)} />
      ) : (
        <div className="frames-browser">
          <aside className="frames-details">
            {selected == null ? (
              <div className="frames-empty-details">
                <Icon name="gallery" size={36} colour="#EE93E3" />
                <p>select a frame.</p>
              </div>
            ) : (
              <>
                <header>
                  <Icon name="gallery" size={36} colour="#EE93E3" />
                  <div>
                    <b>{selected === 0 ? 'live canvas' : `frame #${selected}`}</b>
                    <small>
                      {selected === 0
                        ? `season ${frames.currentSeason + 1} · live canvas`
                        : `season ${(selectedInfo?.season ?? 0) + 1} · ${
                            selectedInfo?.finale ? 'finale' : 'regular frame'
                          }`}
                    </small>
                  </div>
                </header>
                <div className="frames-preview sunken">
                  <PixelPreview image={preview} size={256} />
                </div>
                <div className="preview-toggles">
                  {(['frame', 'DF1 onchain', 'DF1 site'] as PreviewMode[]).map((mode) => (
                    <button
                      key={mode}
                      className={previewMode === mode ? 'active' : ''}
                      disabled={selected === 0 && mode !== 'frame'}
                      title={
                        selected === 0 && mode !== 'frame'
                          ? 'saved frames only until the next lab pass'
                          : mode
                      }
                      onClick={() => setPreviewMode(mode)}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
                <small className="preview-caption">
                  {previewMode === 'frame'
                    ? 'built-in renderer · 256 × 256 · onchain BMP'
                    : previewMode === 'DF1 onchain'
                      ? 'onchain DF1 · exact v1 · 64 × 64, scaled with nearest-neighbour'
                      : 'site preview · 256 × 256 · rendered in your browser, not the onchain image'}
                </small>
                {selectedInfo && (
                  <dl className="frame-details-grid">
                    <dt>minted block</dt>
                    <dd>{selectedInfo.blockNumber.toString()}</dd>
                    <dt>sealed by</dt>
                    <dd>{short(selectedInfo.proposer)} (coinbase)</dd>
                    <dt>DF1</dt>
                    <dd className={selectedInfo.df1Amount >= 200 ? 'storm-text' : ''}>
                      {Math.max(100, selectedInfo.df1Amount)}% ·{' '}
                      {selectedInfo.df1Amount >= 200 ? 'STORM' : 'calm'}
                    </dd>
                    <dt>face / bg</dt>
                    <dd>
                      {paletteLabel(selectedInfo.faceColor)} / {paletteLabel(selectedInfo.backgroundColor)}
                    </dd>
                    <dt>holder at mint</dt>
                    <dd>{selectedInfo.holderAtMint ? 'yes' : 'no'}</dd>
                    <dt>paints since last</dt>
                    <dd>{selectedInfo.paintsSincePreviousFrame.toString()}</dd>
                    <dt>renderer</dt>
                    <dd>{selectedRenderer}</dd>
                    <dt>owner</dt>
                    <dd>{selectedOwner == null ? 'burned' : ownsSelected ? 'you' : short(selectedOwner)}</dd>
                  </dl>
                )}
              </>
            )}
          </aside>
          <main className="frames-grid-pane sunken">
            {rootView ? (
              <div className="season-grid">
                {finaleReady.map((row) => (
                  <div className="season-folder finale-ready" key={`finale-${row.season}`}>
                    <Icon name="gallery" size={36} colour="#5FEDDF" />
                    <b>Season {row.season + 1} finale is ready</b>
                    <small>recipient: {short(row.recipient)}</small>
                    {row.authorized ? (
                      <small>holder of #0 or approved operator</small>
                    ) : row.publicOpen ? (
                      <small>anyone can mint it now; it goes to the holder of #0</small>
                    ) : (
                      <small>
                        only the holder of #0 can mint until{' '}
                        {new Date(Number(row.holderWindowEnds) * 1000).toLocaleString()}
                      </small>
                    )}
                    {row.canMint && (
                      <Button
                        primary
                        disabled={!row.quote || finaleMinting === row.season}
                        onClick={() => void mintFinale(row)}
                      >
                        {finaleMinting === row.season ? 'Minting…' : 'Mint finale'}
                      </Button>
                    )}
                    {row.canMint && <small>{row.quote?.maxCost ?? 'quoting…'}</small>}
                  </div>
                ))}
                {filter === 'Mine' && (
                  <button
                    className="season-folder"
                    onDoubleClick={() => setLabsView(true)}
                    onClick={() => setLabsView(true)}
                  >
                    <Icon name="star" size={36} colour="#5FEDDF" />
                    <b>Labs</b>
                    <small>CDs · block portraits</small>
                  </button>
                )}
                {filter === 'Mine' && mineIds.includes(0) && (
                  <FrameTile
                    tokenId={0}
                    selected={selected === 0}
                    hidden={false}
                    list={false}
                    onSelect={() => setSelected(0)}
                    onOpen={() => setSelected(0)}
                    onContextMenu={(x, y) => openContextMenu(0, x, y)}
                  />
                )}
                {filter === 'Mine' &&
                  (!wallet.account || mineFor === wallet.account) &&
                  !mineIds.some((id) => id > 0) && (
                    <div className="frames-empty">
                      {!wallet.account ? (
                        <p>connect a wallet to see the frames you saved.</p>
                      ) : (
                        <>
                          <p>
                            <b>no saved frames yet.</b>
                          </p>
                          <p>paint something, then in Paint choose File › Save frame…. it shows up here.</p>
                          <Button onClick={() => openProgram('paint')}>Open Paint</Button>
                        </>
                      )}
                    </div>
                  )}
                {frames.seasons
                  .filter((item) => item.count > 0)
                  .filter((item) => filter !== 'Mine' || (mineSeasonCounts.get(item.season) ?? 0) > 0)
                  .map((item) => (
                    <SeasonFolder
                      key={item.season}
                      season={item}
                      count={filter === 'Mine' ? (mineSeasonCounts.get(item.season) ?? 0) : item.count}
                      onOpen={() => navigateSeason(item.season)}
                    />
                  ))}
              </div>
            ) : (
              <div className={`frames-grid ${view}`}>
                {visibleIds.map((tokenId) => (
                  <FrameTile
                    key={tokenId}
                    tokenId={tokenId}
                    info={infos.get(tokenId)}
                    selected={selected === tokenId}
                    hidden={filter === 'Hidden' && isFrameHidden(tokenId)}
                    list={view === 'list'}
                    onSelect={() => setSelected(tokenId)}
                    onOpen={() => {
                      setSelected(tokenId)
                      if (tokenId > 0) openTokenProps(tokenId)
                    }}
                    onContextMenu={(x, y) => openContextMenu(tokenId, x, y)}
                  />
                ))}
                <div ref={sentinel} className="frame-scroll-sentinel" />
              </div>
            )}
          </main>
        </div>
      )}
      <footer className="frames-status">
        <span>
          {currentObjects} object{currentObjects === 1 ? '' : 's'}
          {selected != null ? ` · ${selected === 0 ? 'live canvas' : `frame #${selected}`} selected` : ''}
        </span>
        <span>{season == null ? 'My Frames' : `season ${season + 1}`}</span>
        <span>{short(wallet.account)}</span>
      </footer>
      {contextMenu &&
        (() => {
          const tokenId = contextMenu.tokenId
          const info = tokenId === selected ? selectedInfo : infos.get(tokenId)
          const hidden = isFrameHidden(tokenId)
          const savedFrame = tokenId > 0
          const rendererAllowed = savedFrame && ownsSelected
          const burnAllowed = savedFrame && !info?.finale && ownsSelected
          return (
            <div
              ref={contextMenuRef}
              className="frames-context-menu raised"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              role="menu"
            >
              <button
                role="menuitem"
                onClick={() => {
                  if (savedFrame) openTokenProps(tokenId)
                  setContextMenu(undefined)
                }}
              >
                Open
              </button>
              <button
                role="menuitem"
                disabled={!savedFrame}
                onClick={() => {
                  openTokenProps(tokenId)
                  setContextMenu(undefined)
                }}
              >
                <span>Properties</span>
                <small>Alt+Enter</small>
              </button>
              <div className={`frames-context-renderer ${rendererAllowed ? '' : 'disabled'}`}>
                <button role="menuitem" disabled={!rendererAllowed} aria-haspopup="menu">
                  <span>Renderer</span>
                  <small>▸</small>
                </button>
                <div className="frames-context-submenu raised" role="menu">
                  {renderers.map((renderer) => {
                    const timelapse = renderer.name.toLowerCase() === 'season timelapse'
                    const disabled = !rendererAllowed || (timelapse && !info?.finale)
                    return (
                      <button
                        key={renderer.id}
                        role="menuitem"
                        disabled={disabled}
                        title={disabled && timelapse ? 'finales only' : undefined}
                        onClick={() => {
                          openTokenProps(tokenId, 'Renderer', renderer.name)
                          setContextMenu(undefined)
                        }}
                      >
                        {renderer.name}
                      </button>
                    )
                  })}
                </div>
              </div>
              <hr />
              <button
                role="menuitem"
                disabled={!savedFrame || !info?.finale || !ownsSelected}
                title={
                  !savedFrame
                    ? 'select a saved frame'
                    : !info?.finale
                      ? 'finales only'
                      : !ownsSelected
                        ? 'only the holder can auction this finale'
                        : 'auction this finale'
                }
                onClick={() => {
                  openProgram('auction', true, `#/auction?token=${tokenId}`)
                  setContextMenu(undefined)
                }}
              >
                Auction this finale…
              </button>
              <button
                role="menuitem"
                disabled={!savedFrame}
                title={!savedFrame ? 'live canvas cannot be hidden' : undefined}
                onClick={() => {
                  if (hidden) restoreFrame(tokenId)
                  else hideFrame(tokenId)
                  setContextMenu(undefined)
                }}
              >
                {hidden ? 'Unhide' : 'Hide'}
              </button>
              <button
                role="menuitem"
                disabled={!burnAllowed}
                title={
                  tokenId === 0
                    ? 'live canvas cannot be burned'
                    : info?.finale
                      ? 'finales cannot be burned'
                      : !ownsSelected
                        ? 'only the holder can burn this frame'
                        : burnQuote
                          ? undefined
                          : undefined
                }
                onClick={() => {
                  setContextMenu(undefined)
                  recycleFrame(Number(tokenId))
                }}
              >
                Send to Recycle Bin
              </button>
            </div>
          )
        })()}
      {box && <MessageBox {...box} onClose={() => setBox(undefined)} />}
    </div>
  )
}

/** Open the Recycle Bin with this frame ready to confirm (in-memory request; see recycleIntent.ts). */
function recycleFrame(id: number) {
  requestRecycle(id)
  openProgram('bin')
}
