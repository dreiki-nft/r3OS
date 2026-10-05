import { helpHash } from '../os/helpTopics'
import { screenSafeMessage } from '../chain/errors'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { parseAbi, type Address } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { discoverContracts } from '../chain/contracts'
import { choosePassDisplay } from '../chain/holders'
import { readHeavy } from '../chain/readMany'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { formattedBalance, getWalletSnapshot, subscribeWallet, walletOnCorrectChain } from '../chain/wallet'
import { decodeJsonDataUri } from '../lib/dataUri'
import { R3OS_PAINTER_PASS_ABI, R3OS_PAINT_ABI } from '../lib/generated/abi'
import { readPainterProfile } from '../chain/painterProfile'
import { markProgramDataReady } from '../chain/perf'
import { readPassCoreIdentity, readPassIdentity } from './passData'
import { clearAssistantTip } from '../os/assistantStore'
import { pushBalloon } from '../os/balloons'
import { openProgram } from '../os/programs'
import { closeWindow } from '../os/windows'
import { playSound } from '../os/sound'
import { Button } from '../os/ui/Button'
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
import { WalletChooser } from '../os/WalletChooser'
import { Tabs } from '../os/ui/Tabs'
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

function ipfsUrl(uri: string) {
  return uri.startsWith('ipfs://') ? `${config.ipfsGateway}${uri.slice(7)}` : uri
}

export function PassProgram() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
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
  const [passImage, setPassImage] = useState<string>()
  const [choosingWallet, setChoosingWallet] = useState(false)
  const [displayId, setDisplayId] = useState<bigint | null>(null)
  const [displayOpen, setDisplayOpen] = useState(false)
  const [images, setImages] = useState(new Map<string, string>())
  const [labStamps, setLabStamps] = useState<StampRow[]>([])
  const [selectedStamp, setSelectedStamp] = useState<StampRow>()
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
    if (!wallet.account || !passAddress || hasClaimed || stats.paintCount === 0n) {
      setClaimQuote(undefined)
      return
    }
    void quoteAction({
      kind: 'estimate',
      address: passAddress,
      abi: R3OS_PAINTER_PASS_ABI,
      functionName: 'claim',
      account: wallet.account,
    })
      .then(setClaimQuote)
      .catch(() => setClaimQuote(undefined))
  }, [wallet.account, passAddress, hasClaimed, stats.paintCount])

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
    if (!displayOpen || !collection || !publicClient) return
    let cancelled = false
    void (async () => {
      const missing = ids.filter((id) => !imageMemory.has(`${collection}:${id}`))
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
          const uri = String(row.result)
          const metadata = uri.startsWith('data:')
            ? decodeJsonDataUri<{ image?: string }>(uri)
            : ((await (await fetch(ipfsUrl(uri))).json()) as { image?: string })
          const image = metadata.image ? ipfsUrl(metadata.image) : ''
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
  }, [displayOpen, collection, ids])

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

  const builtIns = useMemo(
    () =>
      builtInStamps({
        firstPaintBlock: stats.firstPaintBlock,
        framesMinted: stats.frames,
        sessionPaints: stats.sessionPaints,
        stormPaints: stats.stormPaints,
        activeDays: stats.activeDays,
        holder: stats.holder,
      }),
    [stats],
  )
  const stamps = [...builtIns, ...labStamps]

  async function claim() {
    if (!wallet.account || !passAddress || !claimQuote) return
    if (!walletOnCorrectChain()) return
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

  const selectedImage = displayId == null ? undefined : images.get(displayId.toString())
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
                    <p>max cost: {claimQuote?.maxCost ?? (eligible ? 'quoting…' : '—')}</p>
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
                <button className="pass-monitor" onClick={() => setDisplayOpen(!displayOpen)}>
                  <div className="monitor-screen">
                    {selectedImage ? (
                      <SafeImage
                        src={selectedImage}
                        alt={displayId == null ? 'r3tards logo' : `r3tard #${displayId}`}
                        width={170}
                        height={140}
                      />
                    ) : (
                      <SafeImage src="/os/brand/logo.png" alt="r3tards logo" width={170} height={140} />
                    )}
                  </div>
                  <i />
                  <b />
                </button>
                <div>
                  <p>System: r3OS painter pass / build {block.block.toString()}</p>
                  <p>
                    Registered to: {short(wallet.account)} / pass #{passId.toString()} · soulbound
                  </p>
                  <div className="display-picker">
                    <Button onClick={() => setDisplayOpen(!displayOpen)}>
                      Display: {displayId == null ? '(none) r3tards logo' : `r3tard #${displayId}`}
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
                            {images.get(id.toString()) ? (
                              <SafeImage
                                src={images.get(id.toString())!}
                                alt={`r3tard #${id}`}
                                width={24}
                                height={24}
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
                  <p>
                    days painted {stats.activeDays.toString()} · pixels {stats.pixels.toString()} · frames{' '}
                    {stats.frames.toString()}
                  </p>
                  <p>
                    session paints {stats.sessionPaints.toString()} · storm paints{' '}
                    {stats.stormPaints.toString()} · first paint block {stats.firstPaintBlock.toString()}
                  </p>
                  {passImage && (
                    <SafeImage
                      className="pass-svg"
                      src={passImage}
                      alt="your Painter Pass, drawn onchain"
                      width={180}
                      height={180}
                    />
                  )}
                  <p>
                    stamps {stamps.filter((stamp) => stamp.earned).length} of {stamps.length}{' '}
                    <Button onClick={() => setTab('Stamps')}>See stamps…</Button>
                  </p>
                </div>
                <div className="manufacturer">
                  <span>Manufactured and supported by:</span>
                  <SafeImage src="/os/brand/pfp-main.webp" alt="r3tards" width={150} height={150} />
                </div>
              </div>
            )}
          </>
        )}
        {tab === 'Stamps' && (
          <div className="device-manager">
            <label>
              <input type="radio" defaultChecked name="view" /> View stamps by type
            </label>
            <label>
              <input type="radio" name="view" /> View by Lab
            </label>
            <TreeView label="Painter Pass stamps">
              <div role="treeitem">
                PAINTER-PASS-{passId.toString()}
                <div role="group">
                  {stamps.map((stamp, index) => (
                    <button
                      role="treeitem"
                      key={`${stamp.name}-${index}`}
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
            </TreeView>
            <GroupBox title="Device status">
              {selectedStamp ? (
                <p>
                  <Icon name={selectedStamp.earned ? 'info' : 'warning'} size={24} />
                  {selectedStamp.name} is{' '}
                  {selectedStamp.earned ? 'working properly.' : 'not working properly. (Code 10)'}
                  <br />
                  <small>{selectedStamp.rule}</small>
                </p>
              ) : (
                <p>Select a stamp.</p>
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
