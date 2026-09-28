import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { parseAbiItem, type Address } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { publicClient, wsClient } from '../chain/clients'
import { discoverContracts } from '../chain/contracts'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { readMany } from '../chain/readMany'
import { R3TARDS_FORKS_ABI, R3TARDS_LABS_ABI, R3TARDS_PAINT_ABI } from '../lib/generated/abi'
import { encodeForkDiff, forkRowsToIndices } from '../lib/forks'
import { PALETTE } from '../lib/palette'
import { getLiveSnapshot, liveActive, subscribeLive } from '../live/liveStore'
import { closeWindow } from '../os/windows'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { IntroBar } from '../os/ui/IntroBar'
import { MenuBar } from '../os/ui/MenuBar'
import { Icon } from '../os/ui/Icon'
import { LabCanvas } from './LabCanvas'
import { errorText, labAddress, sameAddress, shortAddress } from './labCommon'
import { readLabsToken, type LabsTokenData } from './labsToken'

const RULES = [
  "pick a saved frame (or someone else's fork) and fork it. you get the fork as an NFT, starting from that image.",
  'open: anyone can paint it. closed: only you. sealed: frozen forever. only the owner wallet can switch.',
  'paints work like the main canvas: up to 64 px each, 256 px per fork per block, fixed 250K gas limit.',
  'one new fork per wallet every 600 blocks (~3 min). you need to have painted the main canvas once.',
] as const

type ForkInfo = {
  id: bigint
  sourceFrameId: bigint
  parentForkId: bigint
  createdBlock: bigint
  depth: number
  background: number
  face: number
  season: number
  isOpen: boolean
  isSealed: boolean
  paints: bigint
  painters: bigint
  lastPaintBlock: bigint
  timesForked: bigint
  sealedBlock: bigint
}

type ForkLog = { id: bigint; sourceFrameId: bigint; parentForkId: bigint; creator: Address; depth: number }

function parseInfo(id: bigint, value: any): ForkInfo {
  const v = Array.isArray(value) ? value : value
  return {
    id,
    sourceFrameId: BigInt(v.sourceFrameId ?? v[0]),
    parentForkId: BigInt(v.parentForkId ?? v[1]),
    createdBlock: BigInt(v.createdBlock ?? v[2]),
    depth: Number(v.depth ?? v[3]),
    background: Number(v.background ?? v[4]),
    face: Number(v.face ?? v[5]),
    season: Number(v.season ?? v[6]),
    isOpen: Boolean(v.isOpen ?? v[7]),
    isSealed: Boolean(v.isSealed ?? v[8]),
    paints: BigInt(v.paints ?? v[9]),
    painters: BigInt(v.painters ?? v[10]),
    lastPaintBlock: BigInt(v.lastPaintBlock ?? v[11]),
    timesForked: BigInt(v.timesForked ?? v[12]),
    sealedBlock: BigInt(v.sealedBlock ?? v[13]),
  }
}

function routeFrame() {
  return Number(new URLSearchParams(location.hash.split('?')[1] ?? '').get('frame') ?? 0)
}

export function ForksProgram() {
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const live = useSyncExternalStore(subscribeLive, getLiveSnapshot)
  const [address, setAddress] = useState<Address>()
  const [paintAddress, setPaintAddress] = useState<Address>()
  const [labs, setLabs] = useState<Address>()
  const [missing, setMissing] = useState(false)
  const [logs, setLogs] = useState<ForkLog[]>([])
  const [infos, setInfos] = useState(new Map<bigint, ForkInfo>())
  const [selected, setSelected] = useState<bigint>()
  const [owner, setOwner] = useState<Address>()
  const [base, setBase] = useState<Uint8Array>(new Uint8Array(4096))
  const [working, setWorking] = useState<Uint8Array>(new Uint8Array(4096))
  const [colour, setColour] = useState(1)
  const [eraser, setEraser] = useState(false)
  const [forksPainted, setForksPainted] = useState(0n)
  const [lastForkBlock, setLastForkBlock] = useState(0n)
  const [lastPaintByOwner, setLastPaintByOwner] = useState(0n)
  const [daysPainted, setDaysPainted] = useState(0n)
  const [paintQuote, setPaintQuote] = useState<ActionQuote>()
  const [createQuote, setCreateQuote] = useState<ActionQuote>()
  const [switchQuote, setSwitchQuote] = useState<ActionQuote>()
  const [sealQuote, setSealQuote] = useState<ActionQuote>()
  const [createFrame, setCreateFrame] = useState(routeFrame())
  const [createMode, setCreateMode] = useState<'frame' | 'fork'>(() => (routeFrame() > 0 ? 'frame' : 'fork'))
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [meta, setMeta] = useState<LabsTokenData>()
  const [metaVersion, setMetaVersion] = useState(0)
  const baseRef = useRef(new Uint8Array(4096))
  const baseForkRef = useRef<bigint | undefined>(undefined)

  useEffect(() => {
    void Promise.all([labAddress('forks'), discoverContracts()])
      .then(([forks, contracts]) => {
        setAddress(forks)
        setPaintAddress(contracts.paint)
      })
      .catch(() => setMissing(true))
  }, [])

  useEffect(() => {
    const syncRouteFrame = () => {
      const frame = routeFrame()
      if (frame > 0) {
        setCreateFrame(frame)
        setCreateMode('frame')
      }
    }
    syncRouteFrame()
    window.addEventListener('hashchange', syncRouteFrame)
    return () => window.removeEventListener('hashchange', syncRouteFrame)
  }, [])

  const refreshLogs = useCallback(async () => {
    if (!publicClient || !address) return
    try {
      const event = parseAbiItem(
        'event ForkCreated(uint256 indexed forkId,uint256 indexed sourceFrameId,uint256 parentForkId,address indexed creator,uint16 depth)',
      )
      const found = await publicClient.getLogs({ address, event, fromBlock: 0n, toBlock: 'latest' })
      const next = found.map((log) => {
        const args = log.args as any
        return {
          id: BigInt(args.forkId),
          sourceFrameId: BigInt(args.sourceFrameId),
          parentForkId: BigInt(args.parentForkId),
          creator: args.creator as Address,
          depth: Number(args.depth),
        }
      })
      setLogs(next)
      if (!selected && next.length) setSelected(next.at(-1)!.id)
    } catch (error) {
      setMessage(errorText(error))
    }
  }, [address, selected])

  useEffect(() => {
    void refreshLogs()
  }, [refreshLogs])

  const refresh = useCallback(async () => {
    if (!publicClient || !address) return
    try {
      const ids = logs.map((item) => item.id)
      const contracts: any[] = ids.map((id) => ({
        address,
        abi: R3TARDS_FORKS_ABI,
        functionName: 'forkInfo',
        args: [id],
      }))
      contracts.push({ address, abi: R3TARDS_FORKS_ABI, functionName: 'LABS' })
      if (selected) {
        contracts.push({ address, abi: R3TARDS_FORKS_ABI, functionName: 'forkRows', args: [selected] })
      }
      if (wallet.account)
        contracts.push({
          address,
          abi: R3TARDS_FORKS_ABI,
          functionName: 'painterInfo',
          args: [wallet.account],
        })
      if (wallet.account && paintAddress)
        contracts.push({
          address: paintAddress,
          abi: R3TARDS_PAINT_ABI,
          functionName: 'daysPainted',
          args: [wallet.account],
        })
      if (selected && wallet.account)
        contracts.push({
          address,
          abi: R3TARDS_FORKS_ABI,
          functionName: 'lastPaintBlockOf',
          args: [selected, wallet.account],
        })
      if (selected && labs)
        contracts.push({ address: labs, abi: R3TARDS_LABS_ABI, functionName: 'ownerOf', args: [selected] })
      const result = await readMany(contracts as any, { allowFailure: false })
      let cursor = 0
      const next = new Map<bigint, ForkInfo>()
      for (const id of ids) next.set(id, parseInfo(id, result[cursor++]))
      setInfos(next)
      const labsAddress = result[cursor++] as Address
      setLabs(labsAddress)
      if (selected) {
        const rows = result[cursor++] as readonly bigint[]
        const pixels = forkRowsToIndices(rows)
        const previousBase = baseRef.current
        const sameFork = baseForkRef.current === selected
        setWorking((current) => {
          const merged = pixels.slice()
          if (sameFork && previousBase.length === current.length) {
            for (let index = 0; index < current.length; index++) {
              if (current[index] !== previousBase[index]) merged[index] = current[index]
            }
          }
          return merged
        })
        setBase(pixels)
        baseRef.current = pixels.slice()
        baseForkRef.current = selected
      }
      if (wallet.account) {
        const painter = result[cursor++] as any
        setForksPainted(BigInt(painter[0]))
        setLastForkBlock(BigInt(painter[1]))
      }
      if (wallet.account && paintAddress) setDaysPainted(BigInt(result[cursor++] as bigint))
      if (selected && wallet.account) setLastPaintByOwner(BigInt(result[cursor++] as bigint))
      else setLastPaintByOwner(0n)
      if (selected && labs) setOwner(result[cursor++] as Address)
    } catch (error) {
      setMessage(errorText(error))
    }
  }, [address, logs, selected, wallet.account, paintAddress, labs])

  useEffect(() => {
    void refresh()
  }, [refresh, block.block])

  useEffect(() => {
    if (!wsClient || !address) return
    return wsClient.watchContractEvent({
      address,
      abi: R3TARDS_FORKS_ABI,
      onLogs: (eventLogs) => {
        if (eventLogs.some((log) => log.eventName === 'ForkCreated')) void refreshLogs()
        void refresh()
      },
    })
  }, [address, refresh, refreshLogs])

  useEffect(() => {
    if (!selected) return
    setMeta(undefined)
    void metaVersion
    void readLabsToken(selected)
      .then(setMeta)
      .catch(() => undefined)
  }, [selected, metaVersion])

  const info = selected ? infos.get(selected) : undefined
  const encoded = useMemo(() => (info ? encodeForkDiff(base, working) : undefined), [base, working, info])
  const isOwner = sameAddress(owner, wallet.account)
  const paintReason = !wallet.account
    ? 'connect a wallet'
    : !info
      ? 'select a fork'
      : info.isSealed
        ? 'sealed forks are frozen forever'
        : !info.isOpen && !isOwner
          ? 'this fork is closed; only its owner can paint'
          : lastPaintByOwner === block.block
            ? 'already painted this fork this block'
            : !encoded?.pixels
              ? 'draw something first'
              : encoded.tooManyPixels
                ? '64 px max per paint'
                : encoded.tooManyRuns
                  ? '32 runs max per paint'
                  : ''

  useEffect(() => {
    setPaintQuote(undefined)
    if (!address || !wallet.account || !selected || paintReason || !encoded?.hex || encoded.hex === '0x')
      return
    let cancelled = false
    void quoteAction({
      kind: 'forkPaint',
      address,
      abi: R3TARDS_FORKS_ABI,
      functionName: 'paint',
      args: [selected, encoded.hex],
      account: wallet.account,
      signer: liveActive(live) ? 'burner' : 'wallet',
      pixels: encoded.pixels,
      action: `paint fork #${selected}`,
    })
      .then((q) => !cancelled && setPaintQuote(q))
      .catch(() => !cancelled && setPaintQuote(undefined))
    return () => {
      cancelled = true
    }
  }, [address, wallet.account, selected, paintReason, encoded?.hex, live.version])

  const cooldownUntil = lastForkBlock === 0n ? 0n : lastForkBlock + 600n
  const createReason = !wallet.account
    ? 'connect a wallet'
    : daysPainted < 1n
      ? 'paint the main canvas once first'
      : cooldownUntil > block.block
        ? `cooldown until block ${cooldownUntil}`
        : ''
  const createId = createMode === 'fork' ? selected : BigInt(createFrame || 0)

  useEffect(() => {
    setCreateQuote(undefined)
    if (
      !address ||
      !wallet.account ||
      createReason ||
      !createId ||
      (createMode === 'frame' && createId === 0n)
    )
      return
    let cancelled = false
    void quoteAction({
      kind: 'estimate',
      address,
      abi: R3TARDS_FORKS_ABI,
      functionName: createMode === 'fork' ? 'forkFork' : 'forkFrame',
      args: [createId],
      account: wallet.account,
      action: createMode === 'fork' ? `fork fork #${createId}` : `fork frame #${createId}`,
    })
      .then((q) => !cancelled && setCreateQuote(q))
      .catch(() => !cancelled && setCreateQuote(undefined))
    return () => {
      cancelled = true
    }
  }, [address, wallet.account, createReason, createMode, createId?.toString()])

  useEffect(() => {
    setSwitchQuote(undefined)
    setSealQuote(undefined)
    if (!address || !wallet.account || !selected || !isOwner || !info || info.isSealed) return
    let cancelled = false
    const nextOpen = !info.isOpen
    void Promise.all([
      quoteAction({
        kind: 'estimate',
        address,
        abi: R3TARDS_FORKS_ABI,
        functionName: 'setOpen',
        args: [selected, nextOpen],
        account: wallet.account,
        action: `${nextOpen ? 'open' : 'close'} fork #${selected}`,
      }),
      quoteAction({
        kind: 'estimate',
        address,
        abi: R3TARDS_FORKS_ABI,
        functionName: 'seal',
        args: [selected],
        account: wallet.account,
        action: `seal fork #${selected}`,
      }),
    ])
      .then(([nextSwitch, nextSeal]) => {
        if (cancelled) return
        setSwitchQuote(nextSwitch)
        setSealQuote(nextSeal)
      })
      .catch(() => {
        if (!cancelled) {
          setSwitchQuote(undefined)
          setSealQuote(undefined)
        }
      })
    return () => {
      cancelled = true
    }
  }, [address, wallet.account, selected, isOwner, info?.isOpen, info?.isSealed])

  async function doPaint() {
    if (!address || !wallet.account || !selected || !paintQuote || !encoded || encoded.hex === '0x') return
    setPending(true)
    setMessage('')
    try {
      await sendAction({
        kind: 'forkPaint',
        address,
        abi: R3TARDS_FORKS_ABI,
        functionName: 'paint',
        args: [selected, encoded.hex],
        account: wallet.account,
        signer: liveActive(live) ? 'burner' : 'wallet',
        pixels: encoded.pixels,
        quote: paintQuote,
        action: `paint fork #${selected}`,
        successSound: 'success-light',
        confirmHigherCost: async (_old, next) =>
          window.confirm(`gas went up. continue with ${next.maxCost}?`),
      })
      setMetaVersion((value) => value + 1)
      await refresh()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setPending(false)
    }
  }

  async function createFork() {
    if (!address || !wallet.account || !createQuote || !createId) return
    setPending(true)
    setMessage('')
    try {
      const fn = createMode === 'fork' ? 'forkFork' : 'forkFrame'
      await sendAction({
        kind: 'estimate',
        address,
        abi: R3TARDS_FORKS_ABI,
        functionName: fn,
        args: [createId],
        account: wallet.account,
        quote: createQuote,
        action: createMode === 'fork' ? `fork fork #${createId}` : `fork frame #${createId}`,
        successSound: 'success-heavy',
        confirmHigherCost: async (_old, next) =>
          window.confirm(`gas went up. continue with ${next.maxCost}?`),
      })
      setCreateFrame(0)
      setCreateMode('fork')
      await refreshLogs()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setPending(false)
    }
  }

  async function setOpen(nextOpen: boolean) {
    if (
      !address ||
      !wallet.account ||
      !selected ||
      !isOwner ||
      info?.isSealed ||
      !switchQuote ||
      info?.isOpen === nextOpen
    )
      return
    setPending(true)
    try {
      await sendAction({
        kind: 'estimate',
        address,
        abi: R3TARDS_FORKS_ABI,
        functionName: 'setOpen',
        args: [selected, nextOpen],
        account: wallet.account,
        quote: switchQuote,
        action: `${nextOpen ? 'open' : 'close'} fork #${selected}`,
        confirmHigherCost: async (_old, next) =>
          window.confirm(`gas went up. continue with ${next.maxCost}?`),
      })
      setMetaVersion((value) => value + 1)
      await refresh()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setPending(false)
    }
  }

  async function seal() {
    if (!address || !wallet.account || !selected || !isOwner || info?.isSealed || !sealQuote) return
    if (!window.confirm('Sealed forks are frozen forever.')) return
    setPending(true)
    try {
      await sendAction({
        kind: 'estimate',
        address,
        abi: R3TARDS_FORKS_ABI,
        functionName: 'seal',
        args: [selected],
        account: wallet.account,
        quote: sealQuote,
        action: `seal fork #${selected}`,
        successSound: 'success-heavy',
        confirmHigherCost: async (_old, next) =>
          window.confirm(`gas went up. continue with ${next.maxCost}?`),
      })
      setMetaVersion((value) => value + 1)
      await refresh()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setPending(false)
    }
  }

  const parent = info?.parentForkId ? infos.get(info.parentForkId) : undefined
  const siblings = info
    ? (logs
        .filter(
          (item) =>
            item.id !== info.id &&
            item.parentForkId === info.parentForkId &&
            item.sourceFrameId === info.sourceFrameId,
        )
        .map((item) => infos.get(item.id))
        .filter(Boolean) as ForkInfo[])
    : []
  const children = info
    ? (logs
        .filter((item) => item.parentForkId === info.id)
        .map((item) => infos.get(item.id))
        .filter(Boolean) as ForkInfo[])
    : []
  const sourceSiblings = info
    ? (logs
        .filter((item) => item.parentForkId === 0n && item.sourceFrameId === info.sourceFrameId)
        .map((item) => infos.get(item.id))
        .filter(Boolean) as ForkInfo[])
    : []
  const treeItems = info
    ? info.parentForkId === 0n
      ? sourceSiblings
      : ([parent, ...siblings, info, ...children].filter(Boolean) as ForkInfo[])
    : []
  const stateName = info?.isSealed ? 'SEALED' : info?.isOpen ? 'OPEN' : 'CLOSED'
  const stateClass = info?.isSealed ? 'sealed' : info?.isOpen ? 'open' : 'closed'
  const menus = [
    { label: 'File', items: [{ label: 'Close', action: () => closeWindow('forks') }] },
    {
      label: 'Edit',
      items: [{ label: 'Clear pending pixels', disabled: !info, action: () => setWorking(base.slice()) }],
    },
    { label: 'View', items: [{ label: 'Refresh', action: refresh }] },
    {
      label: 'Fork',
      items: [{ label: 'Fork selected fork…', disabled: !selected, action: () => setCreateMode('fork') }],
    },
    { label: 'Help', items: [{ label: 'How it works', disabled: true }] },
  ]

  if (missing) return <div className="lab-missing">this Lab isn't deployed on this network</div>

  return (
    <div className="lab-program forks-program">
      <MenuBar menus={menus} />
      <IntroBar
        lead="remix any saved frame on your own 64 × 64 canvas. forks can be forked again, so every remix keeps its family tree."
        monad="each fork is its own slice of state, so fork paints never contend with main-canvas paints. monad runs them side by side."
        rules={RULES}
        finalLine="paint 3 different forks to earn the FORKER stamp on your Pass."
      />
      <div className="forks-main">
        <section className="fork-tree sunken">
          <div className="fork-tree-source">
            {info ? (
              <>
                frame #{info.sourceFrameId}
                <small>source · season {info.season + 1}</small>
              </>
            ) : (
              'no forks yet'
            )}
          </div>
          {treeItems.map((item) => (
            <button
              key={item.id.toString()}
              className={selected === item.id ? 'selected' : ''}
              onClick={() => setSelected(item.id)}
            >
              <span className="tree-box" />
              <span>
                <b>fork #{item.id.toString()}</b>
                <small>
                  depth {item.depth}
                  {sameAddress(wallet.account, logs.find((log) => log.id === item.id)?.creator)
                    ? ' · yours'
                    : ''}
                </small>
              </span>
              <em className={item.isSealed ? 'sealed' : item.isOpen ? 'open' : 'closed'}>
                {item.isSealed ? 'SEALED' : item.isOpen ? 'OPEN' : 'CLOSED'}
              </em>
            </button>
          ))}
          <small>
            {info
              ? `${sourceSiblings.length} forks of frame #${info.sourceFrameId} · any fork can be forked again, even sealed ones`
              : 'create a fork from a saved frame to begin'}
          </small>
        </section>
        <section className="fork-editor-pane">
          <div className={`fork-state-banner ${stateClass}`}>
            {stateName} {isOwner && !info?.isSealed ? '· owner controls' : ''}
            <small>{selected ? `fork #${selected} · 64 × 64` : 'select a fork'}</small>
          </div>
          <div className="fork-editor-body">
            <div className="lab-tools vertical">
              <Button className={!eraser ? 'pressed' : ''} onClick={() => setEraser(false)}>
                <Icon name="pencil" size={20} />
              </Button>
              <Button className={eraser ? 'pressed' : ''} onClick={() => setEraser(true)}>
                <Icon name="eraser" size={20} />
              </Button>
            </div>
            <div className="lab-canvas-well sunken">
              <LabCanvas
                size={64}
                pixels={working}
                zoom={7.1}
                onPixel={(x, y) =>
                  setWorking((current) => {
                    const next = current.slice()
                    next[y * 64 + x] = eraser ? 0 : colour
                    return next
                  })
                }
              />
            </div>
          </div>
          <div className="fork-palette">
            {PALETTE.map((entry) => (
              <button
                key={entry.index}
                className={colour === entry.index ? 'selected' : ''}
                style={{ background: entry.hex }}
                title={entry.name}
                onClick={() => {
                  setColour(entry.index)
                  setEraser(entry.index === 0)
                }}
              />
            ))}
          </div>
          <div className="fork-paint-row">
            <Button
              primary
              disabled={pending || Boolean(paintReason) || !paintQuote}
              title={paintReason}
              onClick={doPaint}
            >
              Paint fork
            </Button>
            <span>
              {encoded?.pixels ?? 0} / 64 px this paint · {paintQuote?.maxCost ?? '—'}
              <br />
              256 px per fork per block · 250K gas
            </span>
          </div>
        </section>
        <aside className="fork-side">
          <GroupBox title={selected ? `fork #${selected}` : 'fork'}>
            <dl className="lab-dl">
              <dt>owner</dt>
              <dd>{isOwner ? `${shortAddress(owner)} (you)` : shortAddress(owner)}</dd>
              <dt>source</dt>
              <dd>{info ? `frame #${info.sourceFrameId} · season ${info.season + 1}` : '—'}</dd>
              <dt>parent</dt>
              <dd>{info?.parentForkId ? `fork #${info.parentForkId}` : 'none'}</dd>
              <dt>depth</dt>
              <dd>{info ? info.depth : '—'}</dd>
              <dt>created</dt>
              <dd>{info ? `block ${info.createdBlock}` : '—'}</dd>
              <dt>paints</dt>
              <dd>{info ? `${info.paints} paints · ${info.painters} painters` : '—'}</dd>
              <dt>lineage</dt>
              <dd>
                {String(
                  meta?.attributes.Lineage ??
                    (info
                      ? info.depth === 0
                        ? 'Original'
                        : info.depth === 1
                          ? 'Remix'
                          : 'Deep remix'
                      : '—'),
                )}
              </dd>
              <dt>activity</dt>
              <dd>{String(meta?.attributes.Activity ?? '—')}</dd>
              <dt>times forked</dt>
              <dd>{info?.timesForked.toString() ?? '—'}</dd>
              <dt>state</dt>
              <dd>{String(meta?.attributes.State ?? stateName)}</dd>
            </dl>
          </GroupBox>
          <GroupBox title="Owner controls">
            <div className="owner-switch">
              <Button
                disabled={!isOwner || pending || info?.isSealed || info?.isOpen || !switchQuote}
                className={info?.isOpen ? 'pressed' : ''}
                onClick={() => setOpen(true)}
              >
                Open
              </Button>
              <Button
                disabled={!isOwner || pending || info?.isSealed || !info?.isOpen || !switchQuote}
                className={info && !info.isOpen && !info.isSealed ? 'pressed' : ''}
                onClick={() => setOpen(false)}
              >
                Closed
              </Button>
            </div>
            <Button
              className="seal-button"
              disabled={!isOwner || pending || info?.isSealed || !sealQuote}
              onClick={seal}
            >
              Seal forever…
            </Button>
            <small>
              {isOwner && !info?.isSealed
                ? `switch max ${switchQuote?.maxCost ?? 'quoting…'} · seal max ${sealQuote?.maxCost ?? 'quoting…'}`
                : 'only the owner wallet can change this (not live mode or approved operators)'}
            </small>
          </GroupBox>
          <GroupBox title="Fork it">
            <div className="fork-create-row">
              <Button
                disabled={
                  pending || !selected || Boolean(createReason) || (createMode === 'fork' && !createQuote)
                }
                title={createReason || 'fork this fork'}
                onClick={() => {
                  setCreateMode('fork')
                  if (createMode === 'fork') void createFork()
                }}
              >
                Fork fork #{selected?.toString() ?? '…'}…
              </Button>
            </div>
            <label className="lab-field">
              frame #{' '}
              <input
                type="number"
                min="1"
                value={createFrame || ''}
                onChange={(event) => {
                  setCreateFrame(Number(event.target.value))
                  setCreateMode('frame')
                }}
              />
            </label>
            <Button
              disabled={pending || createMode !== 'frame' || Boolean(createReason) || !createQuote}
              title={createReason}
              onClick={createFork}
            >
              Fork a frame…
            </Button>
            <small>
              {createReason || (createQuote ? `max cost ${createQuote.maxCost}` : 'select a source to quote')}
              <br />
              one new fork per 600 blocks (~3 min) · paint the main canvas once to unlock
            </small>
          </GroupBox>
          <GroupBox title="FORKER stamp">
            <div>paint 3 different forks · {forksPainted.toString()} / 3</div>
            <progress max={3} value={Math.min(3, Number(forksPainted))} />
          </GroupBox>
        </aside>
      </div>
      <footer className="lab-status">
        <span>{message || 'remixes of saved frames · separate from the main canvas'}</span>
        <span>{selected ? `fork #${selected}` : '—'}</span>
        <span>#{block.block.toString()}</span>
      </footer>
    </div>
  )
}
