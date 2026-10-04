import { helpHash } from '../helpTopics'
import { screenSafeMessage } from '../../chain/errors'
import '../../labs/artifacts.css'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  encodeAbiParameters,
  encodeFunctionData,
  hexToBytes,
  keccak256,
  parseAbiItem,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { publicClient, wsClient } from '../../chain/clients'
import { config } from '../../chain/config'
import { getLogsWindow, scanBackward } from '../../chain/logs'
import { discoverContracts } from '../../chain/contracts'
import { markProgramDataReady } from '../../chain/perf'
import { readMany } from '../../chain/readMany'
import { quoteAction, sendAction, type ActionQuote } from '../../chain/tx'
import { describeFrames, subscribeRecycleRequests, takeRecycleRequest } from './recycleIntent'
import { formatMaxCost, withTenPercent } from '../../chain/gas'
import { getWalletSnapshot, subscribeWallet } from '../../chain/wallet'
import { getFrameInfoBatch, mineTokenIds, refreshFrameIndex, type FrameInfo } from '../../frames/framesStore'
import { decodePacked4Bpp, getFrameImage, type PixelImage } from '../../frames/frameImage'
import { PixelPreview } from '../../frames/PixelPreview'
import { loadBurner } from '../../live/burner'
import { R3OS_PAINT_ABI, R3OS_RECYCLE_BIN_ABI } from '../../lib/generated/abi'
import { idbGet, idbSet } from '../../lib/idb'
import { openProgram } from '../programs'
import { playSound } from '../sound'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { MenuBar } from '../ui/MenuBar'
import { MessageBox } from '../ui/MessageBox'
import {
  binEligibleFrames,
  mergeRecycleRows,
  recycleCacheRows,
  recyclePath,
  recycleScanPlan,
  type RecycleLogCache,
  type RecycleLogCacheValue,
} from '../../labs/recycle'

const RECYCLED = parseAbiItem(
  'event Recycled(address indexed owner,uint256 indexed frameId,uint256 season,uint256 blockNumber)',
)

type Tombstone = { minter: Address; season: number; blockNumber: bigint; storm: boolean }
type Row = { id: number; owner: Address; deletedAt: bigint; tombstone: Tombstone }
type CachedBurn = { id: number; owner: Address; deletedAt: bigint; season: number; savedBlock: bigint }
type SortKey = 'name' | 'season' | 'deleted' | 'saved' | 'storm' | 'owner'

function short(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—'
}

const ERC721_STORAGE_LOCATION = BigInt('0x80bb2b638cc20bc4d0a60d66940f3ab4a00c1d7b313d8d71e33a90b8ed882d00')

function operatorApprovalSlot(owner: Address, operator: Address) {
  const root = toHex(ERC721_STORAGE_LOCATION + 5n, { size: 32 })
  const inner = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [owner, root]))
  return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [operator, inner]))
}

async function quoteRecycleWithApprovalOverride({
  owner,
  paint,
  bin,
  ids,
  fees,
}: {
  owner: Address
  paint: Address
  bin: Address
  ids: readonly number[]
  fees: ActionQuote
}): Promise<ActionQuote | undefined> {
  if (!publicClient) return undefined
  try {
    const data = encodeFunctionData({
      abi: R3OS_RECYCLE_BIN_ABI,
      functionName: 'recycle',
      args: [ids.map(BigInt)],
    })
    const slot = operatorApprovalSlot(owner, bin)
    const estimate = await (publicClient as any).request({
      method: 'eth_estimateGas',
      params: [
        { from: owner, to: bin, data },
        'latest',
        { [paint]: { stateDiff: { [slot]: toHex(1n, { size: 32 }) } } },
      ],
    })
    return {
      gasLimit: withTenPercent(BigInt(estimate)),
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      maxCost: formatMaxCost(withTenPercent(BigInt(estimate)), fees.maxFeePerGas),
      quotedAtBlock: fees.quotedAtBlock,
    }
  } catch {
    return undefined
  }
}

function tupleTombstone(value: any): Tombstone {
  return {
    minter: (value?.minter ?? value?.[0] ?? zeroAddress) as Address,
    season: Number(value?.season ?? value?.[1] ?? 0),
    blockNumber: BigInt(value?.blockNumber ?? value?.[2] ?? 0),
    storm: Boolean(value?.storm ?? value?.[3] ?? false),
  }
}

function GrayscaleFrame({ id, tombstone }: { id: number; tombstone: Tombstone }) {
  const [image, setImage] = useState<PixelImage>()

  useEffect(() => {
    if (!publicClient) return
    let cancelled = false
    void (async () => {
      const contracts = await discoverContracts()
      if (!contracts.paint || !publicClient) return
      const info = (await publicClient.readContract({
        address: contracts.paint,
        abi: R3OS_PAINT_ABI,
        functionName: 'frameInfo',
        args: [BigInt(id)],
      })) as any
      const raw = (await publicClient.readContract({
        address: contracts.paint,
        abi: R3OS_PAINT_ABI,
        functionName: 'frameData',
        args: [BigInt(id)],
      })) as Hex
      const background = Number(info?.backgroundColor ?? info?.[10] ?? 1)
      const decoded = decodePacked4Bpp(new Uint8Array(hexToBytes(raw)), background)
      for (let i = 0; i < decoded.rgba.length; i += 4) {
        const grey = Math.round(
          decoded.rgba[i] * 0.299 + decoded.rgba[i + 1] * 0.587 + decoded.rgba[i + 2] * 0.114,
        )
        decoded.rgba[i] = grey
        decoded.rgba[i + 1] = grey
        decoded.rgba[i + 2] = grey
      }
      if (!cancelled) setImage(decoded)
    })().catch(() => {
      if (!cancelled) setImage(undefined)
    })
    return () => {
      cancelled = true
    }
  }, [id, tombstone.blockNumber])

  return <PixelPreview image={image} size={34} />
}

function PickerFramePreview({ id }: { id: number }) {
  const [image, setImage] = useState<PixelImage>()

  useEffect(() => {
    let cancelled = false
    void getFrameImage(id)
      .then((next) => {
        if (!cancelled) setImage(next)
      })
      .catch(() => {
        if (!cancelled) setImage(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [id])

  return <PixelPreview image={image} size={46} />
}

export function RecycleBin() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const [bin, setBin] = useState<Address>()
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0n)
  const [mine, setMine] = useState(0n)
  const [leaders, setLeaders] = useState<{ address: Address; count: bigint }[]>([])
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'deleted', asc: false })
  const [pickerOpen, setPickerOpen] = useState(false)
  // undefined while the picker is still looking up the wallet's frames
  const [eligible, setEligible] = useState<{ id: number; info: FrameInfo }[]>()
  const [picked, setPicked] = useState<number[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [quote, setQuote] = useState<ActionQuote>()
  const [recycleQuote, setRecycleQuote] = useState<ActionQuote>()
  const [operatorApproved, setOperatorApproved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const loadSidebar = useCallback(async (address: Address, owner?: Address) => {
    if (!publicClient) return
    const calls = [
      { address, abi: R3OS_RECYCLE_BIN_ABI, functionName: 'totalBurned' },
      { address, abi: R3OS_RECYCLE_BIN_ABI, functionName: 'topBurners' },
      ...(owner ? [{ address, abi: R3OS_RECYCLE_BIN_ABI, functionName: 'burnedBy', args: [owner] }] : []),
    ]
    const result = (await readMany(calls, { allowFailure: true })) as any[]
    if (result[0]?.status === 'success') setTotal(BigInt(result[0].result))
    if (result[1]?.status === 'success') {
      const value = result[1].result as any
      const addresses = (value?.burners ?? value?.[0] ?? []) as Address[]
      const counts = (value?.counts ?? value?.[1] ?? []) as bigint[]
      setLeaders(
        addresses
          .map((entry, index) => ({ address: entry, count: BigInt(counts[index] ?? 0) }))
          .filter((entry) => entry.address !== zeroAddress && entry.count > 0n),
      )
    }
    const mineResult = owner ? result[2] : undefined
    if (mineResult?.status === 'success') setMine(BigInt(mineResult.result))
    else if (!owner) setMine(0n)
  }, [])

  const loadRows = useCallback(async (address: Address) => {
    if (!publicClient) return
    const client = publicClient
    const cacheKey = `${config.chainId}:${address.toLowerCase()}`
    const cached = await idbGet<RecycleLogCacheValue<CachedBurn>>('logCache', cacheKey)
    const cachedRows = recycleCacheRows(cached)
    const fallbackRows = (items: readonly CachedBurn[]): Row[] =>
      items.map((row) => ({
        id: row.id,
        owner: row.owner,
        deletedAt: row.deletedAt,
        tombstone: {
          minter: zeroAddress,
          season: row.season,
          blockNumber: row.savedBlock,
          storm: false,
        },
      }))

    if (cachedRows.length) setRows(fallbackRows(cachedRows))

    const head = await client.getBlockNumber({ cacheTime: 0 })
    const maxBlocks = 50 * config.logsRange
    const plan = recycleScanPlan(cached, head, maxBlocks)
    const logs =
      plan.mode === 'incremental'
        ? await getLogsWindow({
            address,
            event: RECYCLED,
            fromBlock: plan.fromBlock,
            toBlock: plan.toBlock,
            maxBlocks,
          })
        : plan.mode === 'backward'
          ? await scanBackward({
              address,
              event: RECYCLED,
              toBlock: plan.toBlock,
              maxBlocks,
              until: (found) => found.length >= 100,
            })
          : []
    const fresh: CachedBurn[] = logs.map((log: any) => ({
      id: Number(log.args?.frameId ?? 0n),
      owner: (log.args?.owner ?? zeroAddress) as Address,
      deletedAt: BigInt(log.blockNumber ?? 0n),
      season: Number(log.args?.season ?? 0n),
      savedBlock: BigInt(log.args?.blockNumber ?? 0n),
    }))
    const latest = mergeRecycleRows(cachedRows, fresh)
    const nextCache: RecycleLogCache<CachedBurn> = { scannedTo: head, rows: latest }
    await idbSet('logCache', cacheKey, nextCache)

    if (!latest.length) {
      setRows([])
      return
    }
    const reads = await readMany(
      latest.map((row) => ({
        address,
        abi: R3OS_RECYCLE_BIN_ABI,
        functionName: 'tombstone',
        args: [BigInt(row.id)],
      })),
      { allowFailure: true },
    )
    setRows(
      latest.map((row, index) => ({
        id: row.id,
        owner: row.owner,
        deletedAt: row.deletedAt,
        tombstone:
          (reads[index] as any)?.status === 'success'
            ? tupleTombstone((reads[index] as any).result)
            : {
                minter: zeroAddress,
                season: row.season,
                blockNumber: row.savedBlock,
                storm: false,
              },
      })),
    )
  }, [])

  const refresh = useCallback(async () => {
    try {
      const address = (await discoverContracts()).labs['recycle-bin']
      if (!address) throw new Error("this Lab isn't deployed on this network")
      setBin(address)
      await Promise.all([loadSidebar(address, wallet.account), loadRows(address)])
      markProgramDataReady('bin')
    } catch (error) {
      setMessage(screenSafeMessage(error))
    }
  }, [loadRows, loadSidebar, wallet.account])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!wsClient || !bin) return
    return wsClient.watchContractEvent({
      address: bin,
      abi: R3OS_RECYCLE_BIN_ABI,
      eventName: 'Recycled',
      onLogs: (logs) => {
        void (async () => {
          const reads = await readMany(
            logs.map((log) => ({
              address: bin,
              abi: R3OS_RECYCLE_BIN_ABI,
              functionName: 'tombstone',
              args: [log.args.frameId!],
            })),
            { allowFailure: true },
          )
          const additions: Row[] = logs.map((log, index) => ({
            id: Number(log.args.frameId ?? 0n),
            owner: (log.args.owner ?? zeroAddress) as Address,
            deletedAt: log.blockNumber ?? 0n,
            tombstone:
              (reads[index] as any)?.status === 'success'
                ? tupleTombstone((reads[index] as any).result)
                : {
                    minter: zeroAddress,
                    season: Number(log.args.season ?? 0n),
                    blockNumber: BigInt(log.args.blockNumber ?? 0n),
                    storm: false,
                  },
          }))
          setRows((current) => {
            const keys = new Set(additions.map((row) => `${row.id}:${row.deletedAt}`))
            const next = [
              ...additions.reverse(),
              ...current.filter((row) => !keys.has(`${row.id}:${row.deletedAt}`)),
            ].slice(0, 100)
            const cachedRows = next.map((row) => ({
              id: row.id,
              owner: row.owner,
              deletedAt: row.deletedAt,
              season: row.tombstone.season,
              savedBlock: row.tombstone.blockNumber,
            })) satisfies CachedBurn[]
            const scannedTo = additions.reduce(
              (latest, row) => (row.deletedAt > latest ? row.deletedAt : latest),
              0n,
            )
            void idbSet('logCache', `${config.chainId}:${bin.toLowerCase()}`, {
              scannedTo,
              rows: cachedRows,
            } satisfies RecycleLogCache<CachedBurn>)
            return next
          })
          await loadSidebar(bin, wallet.account)
        })()
      },
    })
  }, [bin, loadSidebar, wallet.account])

  // Only in-app requests (My Frames, the desktop Bin) open the confirm dialog. A `?recycle=` in a shared
  // link is ignored on purpose: a link must never pre-arm a burn.
  useEffect(() => {
    const take = () => {
      const id = takeRecycleRequest()
      if (id == null) return
      setPicked([id])
      setConfirmOpen(true)
    }
    take()
    return subscribeRecycleRequests(take)
  }, [])

  const openPicker = async () => {
    if (!wallet.account) return setMessage('connect your wallet first')
    // Open right away with a loading line; the frame lookup can take a moment.
    setEligible(undefined)
    setPicked([])
    setPickerOpen(true)
    try {
      const ids = await mineTokenIds(wallet.account)
      const infos = await getFrameInfoBatch(ids.filter((id) => id > 0))
      const choices = binEligibleFrames(
        ids
          .filter((id) => id > 0)
          .map((id) => ({ id, finale: Boolean(infos.get(id)?.finale), info: infos.get(id)! }))
          .filter((row) => row.info),
      )
      setEligible(choices)
    } catch (error) {
      setEligible([])
      setMessage(screenSafeMessage(error))
    }
  }

  useEffect(() => {
    if (!confirmOpen || !wallet.account || !bin || !picked.length || !publicClient) {
      setQuote(undefined)
      setRecycleQuote(undefined)
      return
    }
    let cancelled = false
    void (async () => {
      const approved = Boolean(
        await publicClient.readContract({
          address: (await discoverContracts()).paint!,
          abi: R3OS_PAINT_ABI,
          functionName: 'isApprovedForAll',
          args: [wallet.account!, bin],
        }),
      )
      if (cancelled) return
      setOperatorApproved(approved)
      const path = recyclePath(picked.length, approved)
      const paint = (await discoverContracts()).paint!
      const next =
        path === 'safeTransfer'
          ? await quoteAction({
              kind: 'estimate',
              address: paint,
              abi: R3OS_PAINT_ABI,
              functionName: 'safeTransferFrom',
              args: [wallet.account!, bin, BigInt(picked[0])],
              account: wallet.account!,
              action: `send frame #${picked[0]} to the Recycle Bin`,
            })
          : path === 'approveThenRecycle'
            ? await quoteAction({
                kind: 'estimate',
                address: paint,
                abi: R3OS_PAINT_ABI,
                functionName: 'setApprovalForAll',
                args: [bin, true],
                account: wallet.account!,
                action: 'approve the Recycle Bin',
              })
            : await quoteAction({
                kind: 'estimate',
                address: bin,
                abi: R3OS_RECYCLE_BIN_ABI,
                functionName: 'recycle',
                args: [picked.map(BigInt)],
                account: wallet.account!,
                action: `recycle ${picked.length} frame${picked.length === 1 ? '' : 's'}`,
              })
      if (!cancelled) {
        setQuote(next)
        if (path === 'approveThenRecycle') {
          const preview = await quoteRecycleWithApprovalOverride({
            owner: wallet.account!,
            paint,
            bin,
            ids: picked,
            fees: next,
          })
          if (!cancelled) setRecycleQuote(preview)
        }
      }
    })().catch((error) => !cancelled && setMessage(screenSafeMessage(error)))
    return () => {
      cancelled = true
    }
  }, [confirmOpen, picked.join(','), wallet.account, bin])

  const executeRecycle = async () => {
    if (!wallet.account || !bin || !quote || !picked.length) return
    setBusy(true)
    try {
      const paint = (await discoverContracts()).paint!
      const path = recyclePath(picked.length, operatorApproved)
      if (path === 'safeTransfer') {
        await sendAction({
          kind: 'estimate',
          address: paint,
          abi: R3OS_PAINT_ABI,
          functionName: 'safeTransferFrom',
          args: [wallet.account, bin, BigInt(picked[0])],
          account: wallet.account,
          quote,
          action: `send frame #${picked[0]} to the Recycle Bin`,
        })
      } else {
        if (path === 'approveThenRecycle') {
          await sendAction({
            kind: 'estimate',
            address: paint,
            abi: R3OS_PAINT_ABI,
            functionName: 'setApprovalForAll',
            args: [bin, true],
            account: wallet.account,
            quote,
            action: 'approve the Recycle Bin',
          })
          const nextRecycleQuote = await quoteAction({
            kind: 'estimate',
            address: bin,
            abi: R3OS_RECYCLE_BIN_ABI,
            functionName: 'recycle',
            args: [picked.map(BigInt)],
            account: wallet.account,
            action: `recycle ${picked.length} frame${picked.length === 1 ? '' : 's'}`,
          })
          setOperatorApproved(true)
          setRecycleQuote(nextRecycleQuote)
          setMessage(`permission granted · recycle ${nextRecycleQuote.maxCost}`)
          await new Promise((resolve) => window.setTimeout(resolve, 250))
          await sendAction({
            kind: 'estimate',
            address: bin,
            abi: R3OS_RECYCLE_BIN_ABI,
            functionName: 'recycle',
            args: [picked.map(BigInt)],
            account: wallet.account,
            quote: nextRecycleQuote,
            action: `recycle ${picked.length} frame${picked.length === 1 ? '' : 's'}`,
          })
        } else {
          await sendAction({
            kind: 'estimate',
            address: bin,
            abi: R3OS_RECYCLE_BIN_ABI,
            functionName: 'recycle',
            args: [picked.map(BigInt)],
            account: wallet.account,
            quote,
            action: `recycle ${picked.length} frame${picked.length === 1 ? '' : 's'}`,
          })
        }
      }
      const before = mine
      await refreshFrameIndex()
      await refresh()
      if (before < 100n && mine + BigInt(picked.length) >= 100n) playSound('success-heavy')
      setPicked([])
      setConfirmOpen(false)
      setPickerOpen(false)
    } catch (error) {
      setMessage(screenSafeMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const sorted = useMemo(() => {
    const value = [...rows]
    value.sort((a, b) => {
      const av =
        sort.key === 'name'
          ? a.id
          : sort.key === 'season'
            ? a.tombstone.season
            : sort.key === 'deleted'
              ? a.deletedAt
              : sort.key === 'saved'
                ? a.tombstone.blockNumber
                : sort.key === 'storm'
                  ? Number(a.tombstone.storm)
                  : a.owner.toLowerCase()
      const bv =
        sort.key === 'name'
          ? b.id
          : sort.key === 'season'
            ? b.tombstone.season
            : sort.key === 'deleted'
              ? b.deletedAt
              : sort.key === 'saved'
                ? b.tombstone.blockNumber
                : sort.key === 'storm'
                  ? Number(b.tombstone.storm)
                  : b.owner.toLowerCase()
      const result = av < bv ? -1 : av > bv ? 1 : 0
      return sort.asc ? result : -result
    })
    return value
  }, [rows, sort])

  const chooseSort = (key: SortKey) =>
    setSort((current) => ({ key, asc: current.key === key ? !current.asc : true }))
  const live = Boolean(wallet.account && loadBurner(wallet.account))

  return (
    <div className="bin-program">
      <MenuBar
        menus={[
          {
            label: 'File',
            items: [
              { label: 'Recycle frames…', action: () => void openPicker() },
              { label: 'Restore', disabled: true, disabledReason: "burned frames can't come back" },
            ],
          },
          {
            label: 'View',
            items: [{ label: 'Details ✓', disabled: true, disabledReason: 'the Bin always shows details' }],
          },
          {
            label: 'Help',
            items: [{ label: 'Help Topics', action: () => openProgram('help', true, helpHash('bin')) }],
          },
        ]}
      />
      <div className="bin-toolbar raised">
        <Button
          onClick={() => void openPicker()}
          disabled={!wallet.account}
          title={!wallet.account ? 'connect a wallet first' : 'choose saved frames to recycle'}
        >
          Recycle frames…
        </Button>
        <Button disabled title="burned frames can't come back">
          Restore
        </Button>
        {live && <span>Live Mode is on · recycling still uses your main wallet.</span>}
      </div>
      <div className="bin-body">
        <aside className="bin-sidebar">
          <span className={`bin-big-icon ${total > 0n ? 'full' : ''}`}>
            <Icon name="trash" size={72} colour="#877549" />
            {total > 0n && <i aria-label="full" />}
          </span>
          <h2>Recycle Bin</h2>
          <p>
            {total.toString()} frame{total === 1n ? '' : 's'} recycled
          </p>
          <section>
            <b>RECYCLER</b>
            <div className="bin-progress">
              <span style={{ width: `${Math.min(100, Number(mine))}%` }} />
            </div>
            <small>{mine.toString()} / 100</small>
            <img
              className={mine >= 100n ? '' : 'locked'}
              src="/os/badges/q12_recycler.png"
              alt="RECYCLER badge"
            />
          </section>
          <section>
            <b>top 10 burners</b>
            <ol className="bin-leaders">
              {leaders.map((entry) => (
                <li
                  key={entry.address}
                  className={wallet.account?.toLowerCase() === entry.address.toLowerCase() ? 'you' : ''}
                >
                  <span>{short(entry.address)}</span>
                  <b>{entry.count.toString()}</b>
                </li>
              ))}
            </ol>
          </section>
        </aside>
        <main className="bin-list sunken">
          <div className="bin-list-head">
            <button
              onClick={() => chooseSort('name')}
              aria-sort={sort.key === 'name' ? (sort.asc ? 'ascending' : 'descending') : 'none'}
              title={`sort by name`}
            >
              Name
              {sort.key === 'name' && <span className="bin-sort">{sort.asc ? ' ▲' : ' ▼'}</span>}
            </button>
            <button
              onClick={() => chooseSort('season')}
              aria-sort={sort.key === 'season' ? (sort.asc ? 'ascending' : 'descending') : 'none'}
              title={`sort by original location`}
            >
              Original location
              {sort.key === 'season' && <span className="bin-sort">{sort.asc ? ' ▲' : ' ▼'}</span>}
            </button>
            <button
              onClick={() => chooseSort('deleted')}
              aria-sort={sort.key === 'deleted' ? (sort.asc ? 'ascending' : 'descending') : 'none'}
              title={`sort by date deleted`}
            >
              Date deleted
              {sort.key === 'deleted' && <span className="bin-sort">{sort.asc ? ' ▲' : ' ▼'}</span>}
            </button>
            <button
              onClick={() => chooseSort('saved')}
              aria-sort={sort.key === 'saved' ? (sort.asc ? 'ascending' : 'descending') : 'none'}
              title={`sort by saved at`}
            >
              Saved at
              {sort.key === 'saved' && <span className="bin-sort">{sort.asc ? ' ▲' : ' ▼'}</span>}
            </button>
            <button
              onClick={() => chooseSort('storm')}
              aria-sort={sort.key === 'storm' ? (sort.asc ? 'ascending' : 'descending') : 'none'}
              title={`sort by storm`}
            >
              Storm
              {sort.key === 'storm' && <span className="bin-sort">{sort.asc ? ' ▲' : ' ▼'}</span>}
            </button>
            <button
              onClick={() => chooseSort('owner')}
              aria-sort={sort.key === 'owner' ? (sort.asc ? 'ascending' : 'descending') : 'none'}
              title={`sort by recycled by`}
            >
              Recycled by
              {sort.key === 'owner' && <span className="bin-sort">{sort.asc ? ' ▲' : ' ▼'}</span>}
            </button>
          </div>
          {sorted.map((row) => (
            <div className="bin-list-row" key={`${row.id}:${row.deletedAt}`}>
              <span className="bin-name">
                <GrayscaleFrame id={row.id} tombstone={row.tombstone} />
                <b>frame #{row.id}</b>
              </span>
              <span>season {row.tombstone.season + 1}</span>
              <span>block {row.deletedAt.toString()}</span>
              <span>block {row.tombstone.blockNumber.toString()}</span>
              <span>{row.tombstone.storm ? 'yes' : 'no'}</span>
              <span>{short(row.owner)}</span>
            </div>
          ))}
          {!sorted.length && <p className="bin-empty">Recycle Bin is empty.</p>}
        </main>
      </div>
      <footer className="bin-status">{message || `recent burns · ${rows.length}`}</footer>

      {pickerOpen && (
        <MessageBox
          title="Recycle frames"
          className="bin-picker-dialog"
          onClose={() => setPickerOpen(false)}
          onDefault={() => {
            if (picked.length) {
              setPickerOpen(false)
              setConfirmOpen(true)
            }
          }}
          onCancel={() => setPickerOpen(false)}
          defaultLabel="Recycle…"
        >
          <div className="bin-picker">
            {eligible == null && <p>looking for your saved frames…</p>}
            {eligible?.length === 0 && (
              <p>
                no frames to recycle. only saved frames can go in the Bin; the live canvas and finales can't.
              </p>
            )}
            {eligible?.map(({ id, info }) => (
              <label key={id} className={picked.includes(id) ? 'selected' : ''}>
                <input
                  type="checkbox"
                  checked={picked.includes(id)}
                  disabled={!picked.includes(id) && picked.length >= 50}
                  onChange={(event) =>
                    setPicked((current) =>
                      event.target.checked
                        ? [...current, id].slice(0, 50)
                        : current.filter((value) => value !== id),
                    )
                  }
                />
                <span className="bin-picker-preview" aria-hidden="true">
                  <PickerFramePreview id={id} />
                </span>
                <span className="bin-picker-copy">
                  <b>frame #{id}</b>
                  <small>season {info.season + 1}</small>
                </span>
              </label>
            ))}
          </div>
          <small>{picked.length} / 50 selected · finales and token #0 cannot be recycled</small>
        </MessageBox>
      )}

      {confirmOpen && picked.length > 0 && (
        <MessageBox
          title="Confirm recycle"
          kind="warning"
          message={`Are you sure you want to send ${describeFrames(picked)} to the Recycle Bin? Recycling burns ${picked.length === 1 ? 'it' : 'them'} forever. This can't be undone.`}
          details={
            picked.length > 1 && !operatorApproved
              ? `one-time permission so the Bin can burn frames you pick\napproval max cost: ${quote?.maxCost ?? 'quoting…'}\nrecycle max cost: ${recycleQuote?.maxCost ?? 'quoted immediately after approval, before the second wallet prompt'}\nconfirming this batch continues straight from approval into recycle.`
              : `recycle max cost: ${quote?.maxCost ?? recycleQuote?.maxCost ?? 'quoting…'}`
          }
          defaultLabel={busy ? 'Recycling…' : 'Recycle'}
          onDefault={() => void executeRecycle()}
          onCancel={() => setConfirmOpen(false)}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </div>
  )
}
