import { helpHash } from '../os/helpTopics'
import { friendlyError, screenSafeMessage } from '../chain/errors'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { parseAbi, type Address } from 'viem'
import { blockEta, getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { discoverContracts } from '../chain/contracts'
import { choosePassDisplay } from '../chain/holders'
import { readHeavy } from '../chain/readMany'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import {
  formattedBalance,
  getWalletSnapshot,
  subscribeWallet,
  switchToMonad,
  walletOnCorrectChain,
} from '../chain/wallet'
import { decodeJsonDataUri } from '../lib/dataUri'
import { R3OS_PAINTER_PASS_ABI, R3OS_PAINT_ABI } from '../lib/generated/abi'
import { readPainterProfile } from '../chain/painterProfile'
import { markProgramDataReady } from '../chain/perf'
import { readPassCoreIdentity, readPassIdentity } from './passData'
import { clearAssistantTip } from '../os/assistantStore'
import { pushBalloon } from '../os/balloons'
import { openProgram, programById } from '../os/programs'
import { closeWindow } from '../os/windows'
import { playSound } from '../os/sound'
import { Button } from '../os/ui/Button'
import { FeeNote } from '../os/ui/FeeNote'
import { GroupBox } from '../os/ui/GroupBox'
import { Icon } from '../os/ui/Icon'
import { ListBox } from '../os/ui/ListBox'
import { MessageBox } from '../os/ui/MessageBox'
import { ProgressSegments } from '../os/ui/ProgressSegments'
import {
  formatLiveTime,
  getLiveSnapshot,
  liveActive,
  liveTimeLeftMs,
  setLiveOwner,
  subscribeLive,
} from '../live/liveStore'
import { HardwareProfiles } from './HardwareProfiles'
import { SafeImage } from '../os/ui/SafeImage'
import { resolveTokenImage, scatterImageUrl } from './r3tardImages'
import { PoweredByMonad } from '../os/ui/PoweredByMonad'
import {
  nadNameStatus,
  nadNamesAvailable,
  painterName,
  refreshPainterName,
  usePainterNames,
} from '../chain/names'
import { WalletChooser } from '../os/WalletChooser'
import { Tabs } from '../os/ui/Tabs'
import { useSeasonStanding } from './seasonRank'
import { TreeView } from '../os/ui/TreeView'
import { OperatorTab } from '../operator/OperatorTab'
import { subscribeCanvasActivity } from '../paint/canvasStore'
import { builtInStamps, loadLabStamps, type StampRow } from './stamps'
import { retiredAddresses } from '../os/retired'

const COLLECTION_ABI = parseAbi([
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function ownerOf(uint256 tokenId) view returns (address)',
])

const EMPTY_STATS = {
  activeDays: 0n,
  pixels: 0n,
  frames: 0n,
  firstPaintBlock: 0n,
  paintCount: 0n,
  sessionPaints: 0n,
  stormPaints: 0n,
  holder: false,
}

const imageMemory = new Map<string, string>()
const passImageMemory = new Map<string, string>()
const PASS_TABS = ['General', 'Stamps', 'Hardware Profiles', 'Performance', 'Operator']

function short(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—'
}

function displayKey(owner: Address) {
  return `r3os.passDisplay.${config.chainId}.${owner.toLowerCase()}`
}

function readStoredDisplay(owner: Address) {
  try {
    return localStorage.getItem(displayKey(owner))
  } catch {
    return null
  }
}

function writeStoredDisplay(owner: Address, value: bigint | null) {
  try {
    localStorage.setItem(displayKey(owner), value == null ? 'none' : value.toString())
  } catch {
    // Display choice is optional.
  }
}

export function PassProgram() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const standing = useSeasonStanding(wallet.account)
  usePainterNames()
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const live = useSyncExternalStore(subscribeLive, getLiveSnapshot)
  const [tab, setTab] = useState(() => {
    const raw = new URLSearchParams(location.hash.split('?')[1] ?? '').get('tab')
    // 'Device Manager' was the old name of the Stamps tab; old links still land there.
    const requested = raw === 'Device Manager' ? 'Stamps' : raw
    return PASS_TABS.includes(requested ?? '') ? requested! : 'General'
  })
  const [passAddress, setPassAddress] = useState<Address>()
  const [collection, setCollection] = useState<Address>()
  const [passId, setPassId] = useState(0n)
  const [hasClaimed, setHasClaimed] = useState(false)
  const [ids, setIds] = useState<bigint[]>([])
  const [stats, setStats] = useState(EMPTY_STATS)
  const [claimQuote, setClaimQuote] = useState<ActionQuote>()
  const [claimQuoteError, setClaimQuoteError] = useState('')
  const [quoteTry, setQuoteTry] = useState(0)
  const [passImage, setPassImage] = useState<string>()
  const [choosingWallet, setChoosingWallet] = useState(false)
  const [displayId, setDisplayId] = useState<bigint | null>(null)
  const [displayOpen, setDisplayOpen] = useState(false)
  const [images, setImages] = useState(new Map<string, string>())
  // r3tards whose Scatter image failed in this browser; those fall back to their IPFS metadata.
  const [scatterFailed, setScatterFailed] = useState<ReadonlySet<string>>(new Set())
  const [labStamps, setLabStamps] = useState<StampRow[]>([])
  const [selectedStamp, setSelectedStamp] = useState<StampRow>()
  const [stampView, setStampView] = useState<'type' | 'lab'>('type')
  const [budget, setBudget] = useState<readonly bigint[]>([0n, 0n, 0n, 0n, 0n])
  const [box, setBox] = useState<{ title: string; message: string; kind?: 'info' | 'warning' | 'error' }>()
  const [identityLoaded, setIdentityLoaded] = useState(false)
  const [statsLoaded, setStatsLoaded] = useState(false)

  const loadIdentity = useCallback(async (force = false) => {
    if (!wallet.account) return
    const owner = wallet.account
    const identity = await readPassCoreIdentity(owner, force)
    if (getWalletSnapshot().account?.toLowerCase() !== owner.toLowerCase()) return
    setPassAddress(identity.passAddress)
    setCollection(identity.collection)
    setPassId(identity.passId)
    setHasClaimed(identity.hasClaimed)
    setIdentityLoaded(true)
  }, [wallet.account])

  const loadHolderIdentity = useCallback(async (force = false) => {
    if (!wallet.account) return
    const owner = wallet.account
    const identity = await readPassIdentity(owner, force)
    if (getWalletSnapshot().account?.toLowerCase() !== owner.toLowerCase()) return
    setIds(identity.holderIds)
    setDisplayId(choosePassDisplay(identity.holderIds, readStoredDisplay(owner)))
  }, [wallet.account])

  const loadStats = useCallback(async (force = false) => {
    if (!wallet.account || !config.paintAddress) return
    const { stats: values, holder } = await readPainterProfile(wallet.account, force)
    setStats({
      activeDays: values[0] ?? 0n,
      pixels: values[2] ?? 0n,
      frames: values[3] ?? 0n,
      firstPaintBlock: values[4] ?? 0n,
      paintCount: values[6] ?? 0n,
      sessionPaints: values[8] ?? 0n,
      stormPaints: values[9] ?? 0n,
      holder,
    })
    setStatsLoaded(true)
  }, [wallet.account])

  useEffect(() => {
    void loadIdentity()
    void loadStats()
    // Holder-token discovery can be several RPC strategies on non-enumerable collections. Keep it warm,
    // but do not make My Pass wait for it before the primary identity/stats UI is usable.
    void loadHolderIdentity()
  }, [loadIdentity, loadStats, loadHolderIdentity])

  useEffect(() => {
    if (!wallet.account || (identityLoaded && statsLoaded)) markProgramDataReady('pass')
  }, [wallet.account, identityLoaded, statsLoaded])

  useEffect(() => setLiveOwner(wallet.account), [wallet.account])

  useEffect(() => {
    const route = () => {
      const raw = new URLSearchParams(location.hash.split('?')[1] ?? '').get('tab')
      const requested = raw === 'Device Manager' ? 'Stamps' : raw
      if (requested && PASS_TABS.includes(requested)) setTab(requested)
    }
    window.addEventListener('hashchange', route)
    return () => window.removeEventListener('hashchange', route)
  }, [])

  useEffect(
    () =>
      subscribeCanvasActivity((activity) => {
        if (!wallet.account) return
        const account = wallet.account.toLowerCase()
        if (activity.owner?.toLowerCase() === account || activity.minter?.toLowerCase() === account) {
          void loadStats(true)
        }
      }),
    [wallet.account, loadStats],
  )

  useEffect(() => {
    setClaimQuoteError('')
    if (!wallet.account || !passAddress || hasClaimed || stats.paintCount === 0n) {
      setClaimQuote(undefined)
      return
    }
    let cancelled = false
    void quoteAction({
      kind: 'estimate',
      address: passAddress,
      abi: R3OS_PAINTER_PASS_ABI,
      functionName: 'claim',
      account: wallet.account,
    })
      .then((quote) => !cancelled && setClaimQuote(quote))
      .catch((error) => {
        if (cancelled) return
        setClaimQuote(undefined)
        // Say why instead of "quoting…" forever.
        setClaimQuoteError(screenSafeMessage(error))
      })
    return () => {
      cancelled = true
    }
  }, [wallet.account, passAddress, hasClaimed, stats.paintCount, quoteTry])

  const statsKey = [
    stats.activeDays,
    stats.pixels,
    stats.frames,
    stats.stormPaints,
    stats.sessionPaints,
    stats.holder,
  ].join(':')
  useEffect(() => {
    if (tab !== 'General' || !passAddress || !passId || !publicClient) return
    const client = publicClient
    const key = `${passId}:${statsKey}`
    const cached = passImageMemory.get(key)
    if (cached) {
      setPassImage(cached)
      return
    }
    void (async () => {
      const uri = (await client.readContract({
        address: passAddress,
        abi: R3OS_PAINTER_PASS_ABI,
        functionName: 'tokenURI',
        args: [passId],
      })) as string
      const metadata = decodeJsonDataUri<{ image?: string }>(uri)
      if (metadata.image) {
        passImageMemory.set(key, metadata.image)
        setPassImage(metadata.image)
      }
    })()
  }, [tab, passAddress, passId, statsKey])

  useEffect(() => {
    // General shows the stamp count too, so both tabs need the Lab stamps (one load per open).
    if ((tab !== 'Stamps' && tab !== 'General') || !passAddress || !wallet.account) return
    // Stamps whose source is a retired Lab are not shown (they can't be earned from the interface).
    void Promise.all([loadLabStamps(passAddress, wallet.account), discoverContracts()]).then(
      ([rows, contracts]) => {
        const retired = retiredAddresses(contracts.labs)
        setLabStamps(rows.filter((row) => !row.source || !retired.has(row.source.toLowerCase())))
      },
    )
  }, [tab, passAddress, wallet.account])

  useEffect(() => {
    if (!collection || !publicClient) return
    // The chosen r3tard is shown on the monitor at once, so its picture loads even with the picker closed
    // (it used to load only while the picker was open, so after a reload the monitor showed the logo).
    const shown = displayOpen ? ids : displayId != null ? [displayId] : []
    // Scatter serves mainnet r3tards directly; read metadata only where it doesn't apply or failed.
    const wanted = shown.filter((id) => !scatterImageUrl(id, collection) || scatterFailed.has(id.toString()))
    if (!wanted.length) return
    let cancelled = false
    void (async () => {
      const missing = wanted.filter((id) => !imageMemory.has(`${collection}:${id}`))
      const rows = await readHeavy(
        missing.map((id) => ({
          address: collection,
          abi: COLLECTION_ABI,
          functionName: 'tokenURI',
          args: [id],
        })),
      )
      for (let index = 0; index < missing.length; index++) {
        const row = rows[index]
        if (row?.status !== 'success') continue
        try {
          const image = await resolveTokenImage(String(row.result))
          if (image) imageMemory.set(`${collection}:${missing[index]}`, image)
        } catch {
          // A single broken metadata URI should not block the picker.
        }
      }
      if (cancelled) return
      setImages(new Map(ids.map((id) => [id.toString(), imageMemory.get(`${collection}:${id}`) ?? ''])))
    })()
    return () => {
      cancelled = true
    }
  }, [displayOpen, displayId, collection, ids, scatterFailed])

  useEffect(() => {
    if (tab !== 'Performance' || !wallet.account || !publicClient || !config.paintAddress) return
    void publicClient
      .readContract({
        address: config.paintAddress,
        abi: R3OS_PAINT_ABI,
        functionName: 'budgetOf',
        args: [wallet.account, ids],
      })
      .then((value) => setBudget(value as readonly bigint[]))
  }, [tab, wallet.account, ids])

  // Minute resolution is plenty for "next storm in …", and keeps this from recomputing every block.
  const stormNote = block.storm
    ? 'a storm is on right now: paint to earn it.'
    : block.nextStormIn > 0n
      ? `next storm in about ${formatLiveTime(blockEta(block.nextStormIn))}.`
      : undefined
  const builtIns = useMemo(
    () =>
      builtInStamps({
        firstPaintBlock: stats.firstPaintBlock,
        framesMinted: stats.frames,
        sessionPaints: stats.sessionPaints,
        stormPaints: stats.stormPaints,
        activeDays: stats.activeDays,
        holder: stats.holder,
        stormNote,
      }),
    [stats, stormNote],
  )
  const stamps = [...builtIns, ...labStamps]

  async function claim() {
    if (!wallet.account || !passAddress || !claimQuote) return
    // This used to return silently on another network, so the button looked dead (seen in Trust Wallet's
    // browser, which can switch networks without telling the page).
    if (!walletOnCorrectChain()) {
      try {
        await switchToMonad()
      } catch (error) {
        const friendly = friendlyError(error)
        setBox({ title: 'Painter Pass', message: friendly.message, kind: friendly.rejected ? 'info' : 'error' })
        return
      }
    }
    try {
      await sendAction({
        kind: 'estimate',
        address: passAddress,
        abi: R3OS_PAINTER_PASS_ABI,
        functionName: 'claim',
        account: wallet.account,
        quote: claimQuote,
        successSound: 'success-heavy',
      })
      clearAssistantTip('nice. you can claim a painter pass now')
      await loadIdentity(true)
      await loadStats(true)
      pushBalloon({ title: 'Painter Pass', body: 'pass claimed. soulbound, grants absolutely nothing.' })
    } catch (error) {
      setBox({
        title: 'Painter Pass',
        message: screenSafeMessage(error),
        kind: 'error',
      })
    }
  }

  const r3tardImage = (id: bigint) => {
    const scatter = scatterFailed.has(id.toString()) ? '' : scatterImageUrl(id, collection)
    return scatter || images.get(id.toString()) || ''
  }
  const markScatterFailed = (id: bigint) => {
    if (!scatterImageUrl(id, collection)) return
    setScatterFailed((current) => new Set(current).add(id.toString()))
  }
  const selectedImage = displayId == null ? undefined : r3tardImage(displayId)
  const eligible = stats.paintCount > 0n && !hasClaimed

  return (
    <div className="pass-program">
      <Tabs tabs={PASS_TABS} active={tab} onChange={setTab} />
      <div className="pass-tab">
        {tab === 'General' && (
          <>
            {!passId ? (
              <div>
                <h3>Painter Pass</h3>
                <p>
                  {!wallet.account
                    ? 'connect a wallet to claim your Pass.'
                    : eligible
                      ? 'eligible: you painted the canvas.'
                      : stats.paintCount === 0n
                        ? 'paint at least one pixel first, then come back to claim.'
                        : 'this address already claimed once.'}
                </p>
                {!wallet.account ? (
                  <>
                    <p>
                      your Pass is a free, soulbound badge that fills with stamps as you paint, save frames
                      and explore. one per wallet.
                    </p>
                    <Button primary onClick={() => setChoosingWallet(true)}>
                      Connect wallet
                    </Button>
                    {choosingWallet && <WalletChooser onClose={() => setChoosingWallet(false)} />}
                  </>
                ) : (
                  <>
                    <p>
                      max cost:{' '}
                      {claimQuote?.maxCost ??
                        (!eligible ? '—' : claimQuoteError ? "couldn't check the cost" : 'quoting…')}
                    </p>
                    {eligible && !claimQuote && claimQuoteError && (
                      <p className="pass-claim-error" role="alert">
                        {claimQuoteError}{' '}
                        <Button onClick={() => setQuoteTry((count) => count + 1)}>Try again</Button>
                      </p>
                    )}
                    <FeeNote />
                    <Button
                      primary
                      disabled={!eligible || !claimQuote}
                      title={
                        !wallet.account
                          ? 'connect a wallet first'
                          : !eligible
                            ? stats.paintCount === 0n
                              ? 'paint at least one pixel first'
                              : 'this address already claimed'
                            : !claimQuote
                              ? 'checking the cost…'
                              : 'claim your Painter Pass'
                      }
                      onClick={() => void claim()}
                    >
                      Claim Painter Pass
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <div className="pass-general">
                <div className="pass-top">
                  <div className="pass-display">
                    <button className="pass-monitor" onClick={() => setDisplayOpen(!displayOpen)}>
                      <div className="monitor-screen">
                        {selectedImage ? (
                          <SafeImage
                            src={selectedImage}
                            alt={displayId == null ? 'r3tards logo' : `r3tard #${displayId}`}
                            width={170}
                            height={140}
                            noReferrer
                            onFail={() => displayId != null && markScatterFailed(displayId)}
                          />
                        ) : (
                          <SafeImage src="/os/brand/logo.png" alt="r3tards logo" width={170} height={140} />
                        )}
                      </div>
                      <i />
                      <b />
                    </button>
                    <div className="display-picker">
                      <Button onClick={() => setDisplayOpen(!displayOpen)}>
                        Display: {displayId == null ? 'r3tards logo' : `r3tard #${displayId}`} ▾
                      </Button>
                      {displayOpen && (
                        <ListBox label="Display r3tard">
                          <button
                            role="option"
                            onClick={() => {
                              setDisplayId(null)
                              if (wallet.account) writeStoredDisplay(wallet.account, null)
                              setDisplayOpen(false)
                              playSound('select')
                            }}
                          >
                            <Icon name="frog" size={24} /> (none) r3tards logo
                          </button>
                          {ids.map((id) => (
                            <button
                              role="option"
                              key={id.toString()}
                              onClick={() => {
                                setDisplayId(id)
                                if (wallet.account) writeStoredDisplay(wallet.account, id)
                                setDisplayOpen(false)
                                playSound('select')
                              }}
                            >
                              {r3tardImage(id) ? (
                                <SafeImage
                                  src={r3tardImage(id)}
                                  alt={`r3tard #${id}`}
                                  width={24}
                                  height={24}
                                  noReferrer
                                  onFail={() => markScatterFailed(id)}
                                />
                              ) : (
                                <Icon name="frog" size={24} />
                              )}
                              r3tard #{id.toString()}
                            </button>
                          ))}
                          <small>r3tards in {short(wallet.account)} · saved on this device</small>
                        </ListBox>
                      )}
                    </div>
                  </div>
                  <div className="pass-identity">
                    <small className="pass-kicker">R3OS PAINTER PASS · BUILD {block.block.toString()}</small>
                    <b className="pass-number">Pass #{passId.toString()}</b>
                    <span title={wallet.account}>
                      {painterName(wallet.account)} · {short(wallet.account)} · <em>soulbound</em>
                    </span>
                    {nadNamesAvailable() && nadNameStatus(wallet.account) === 'none' && (
                      <small className="pass-name-hint">
                        own a .nad name? it shows here and on the TV once it's this wallet's primary name: on{' '}
                        <a href="https://nad.domains" target="_blank" rel="noopener noreferrer">
                          nad.domains
                        </a>{' '}
                        open My Names, pick it and press "Set as primary name".{' '}
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => refreshPainterName(wallet.account)}
                        >
                          check again
                        </button>
                      </small>
                    )}
                    {nadNamesAvailable() && nadNameStatus(wallet.account) === 'hidden' && (
                      <small className="pass-name-hint">
                        your primary .nad name uses characters r3OS doesn't show (only a-z, 0-9, - and _, up
                        to 32), so you get a nickname instead.{' '}
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => refreshPainterName(wallet.account)}
                        >
                          check again
                        </button>
                      </small>
                    )}
                    <dl className="pass-stats">
                      {(
                        [
                          ['DAYS PAINTED', stats.activeDays.toString()],
                          ['PIXELS', stats.pixels.toLocaleString('en-US')],
                          ['FRAMES', stats.frames.toString()],
                          ['SESSION PAINTS', stats.sessionPaints.toString()],
                          ['STORM PAINTS', stats.stormPaints.toString()],
                          ['FIRST PAINT', stats.firstPaintBlock ? `#${stats.firstPaintBlock}` : '—'],
                          [
                            'SEASON RANK',
                            standing?.rank && standing.of ? `#${standing.rank} of ${standing.of}` : '—',
                          ],
                          ['STORM TICKETS', String(standing?.tickets ?? 0)],
                        ] as const
                      ).map(([label, value]) => (
                        <div className="sunken" key={label}>
                          <dt>{label}</dt>
                          <dd className={value.length > 6 ? 'long' : ''}>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </div>
                <fieldset className="group-box pass-art-box">
                  <legend>Your Pass, drawn onchain</legend>
                  {passImage ? (
                    <SafeImage
                      className="pass-svg"
                      src={passImage}
                      alt="your Painter Pass, drawn onchain"
                      width={168}
                      height={168}
                    />
                  ) : (
                    <span className="pass-svg pass-svg-empty">loading pass…</span>
                  )}
                  <div className="pass-stamps">
                    <b>
                      stamps {stamps.filter((stamp) => stamp.earned).length} of {stamps.length}
                    </b>
                    {/* Filled left to right, one segment per stamp: a progress bar, not a map of which ones. */}
                    <div className="pass-stamp-bar sunken" aria-hidden="true">
                      {stamps.map((stamp, index) => (
                        <i
                          key={`${stamp.name}-${index}`}
                          className={index < stamps.filter((row) => row.earned).length ? 'on' : ''}
                        />
                      ))}
                    </div>
                    <small>the art updates as you paint: every stat above is read from the contract.</small>
                    <Button onClick={() => setTab('Stamps')}>See stamps…</Button>
                  </div>
                </fieldset>
                <div className="pass-credits">
                  <span>
                    Manufactured and
                    <br />
                    supported by
                  </span>
                  <SafeImage src="/os/brand/pfp-main.webp" alt="r3tards" width={64} height={64} />
                  <SafeImage
                    src="/os/brand/pfp-builder.webp"
                    alt="dreiki, the builder"
                    width={64}
                    height={64}
                  />
                  <PoweredByMonad className="pass-powered" />
                </div>
              </div>
            )}
          </>
        )}
        {tab === 'Stamps' && (
          <div className="device-manager">
            <label>
              <input type="radio" checked={stampView === 'type'} onChange={() => setStampView('type')} name="view" />{' '}
              View stamps by type
            </label>
            <label>
              <input type="radio" checked={stampView === 'lab'} onChange={() => setStampView('lab')} name="view" />{' '}
              View by Lab
            </label>
            <TreeView label="Painter Pass stamps">
              {(stampView === 'type'
                ? [{ group: `PAINTER-PASS-${passId.toString()}`, rows: stamps }]
                : [...new Set(stamps.map((stamp) => stamp.lab))].map((lab) => ({
                    group: lab,
                    rows: stamps.filter((stamp) => stamp.lab === lab),
                  }))
              ).map(({ group, rows }) => (
                <div role="treeitem" key={group}>
                  {group}
                  <div role="group">
                    {rows.map((stamp, index) => (
                      <button
                        role="treeitem"
                        key={`${stamp.name}-${index}`}
                        aria-selected={selectedStamp?.name === stamp.name}
                        onClick={() => {
                          setSelectedStamp(stamp)
                          playSound(stamp.earned ? 'select' : 'error')
                        }}
                      >
                        <Icon
                          name={stamp.earned ? 'medal' : 'warning'}
                          size={20}
                          colour={stamp.earned ? '#5FEDDF' : '#FEC343'}
                        />
                        {stamp.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </TreeView>
            <GroupBox title="Device status">
              {selectedStamp ? (
                <div className="stamp-status">
                  <p className="stamp-status-head">
                    <Icon name={selectedStamp.earned ? 'info' : 'warning'} size={24} />
                    <span>
                      {selectedStamp.name} is{' '}
                      {selectedStamp.earned ? 'working properly.' : 'not working properly. (Code 10)'}
                    </span>
                  </p>
                  {selectedStamp.earned ? (
                    <p>earned: {selectedStamp.rule}</p>
                  ) : (
                    <>
                      <p>not earned yet. to fix it, {selectedStamp.rule}</p>
                      {selectedStamp.progress && <p className="stamp-progress">{selectedStamp.progress}</p>}
                      {selectedStamp.program && (
                        <Button onClick={() => openProgram(selectedStamp.program!)}>
                          Open {programById(selectedStamp.program)?.title ?? 'program'}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <p>Select a stamp to see how to earn it.</p>
              )}
            </GroupBox>
          </div>
        )}
        {tab === 'Hardware Profiles' && <HardwareProfiles />}
        {tab === 'Operator' && <OperatorTab />}
        {tab === 'Performance' && (
          <>
            <GroupBox title="Performance status">
              <p>Pixel budget {String(budget[2])} total available</p>
              <ProgressSegments value={Number(budget[0])} max={Math.max(1, Number(budget[3]))} />
              <p>Trust level: {String(budget[4])} active days</p>
              <p>Holder quota ids: {ids.map(String).join(', ') || 'none'}</p>
              <p>MON balance: {formattedBalance()}</p>
              <p>
                Live mode:{' '}
                {liveActive(live)
                  ? `connected by session key · ${formatLiveTime(liveTimeLeftMs(live.session))} left`
                  : 'off'}
              </p>
              <p>Region pressure: {block.storm ? 'STORM 200%' : 'calm / local pressure'}</p>
              <p>Next storm: {block.storm ? 'now' : `${block.nextStormIn} blocks`}</p>
              <p>
                <Icon name="info" size={20} /> Your system is configured for optimal painting.
              </p>
            </GroupBox>
            <div className="advanced-buttons">
              <Button
                onClick={() =>
                  setBox({
                    title: 'Holder quota',
                    message: `ids in use: ${ids.map(String).join(', ') || 'none'}`,
                  })
                }
              >
                Holder quota…
              </Button>
              <Button onClick={() => openProgram('sounds')}>Sounds…</Button>
              <Button onClick={() => openProgram('help', true, helpHash('pass'))}>Help…</Button>
            </div>
          </>
        )}
      </div>
      <div className="dialog-actions">
        <Button primary onClick={() => closeWindow('pass')}>
          OK
        </Button>
        <Button onClick={() => closeWindow('pass')}>Cancel</Button>
      </div>
      {box && <MessageBox {...box} onClose={() => setBox(undefined)} />}
    </div>
  )
}
