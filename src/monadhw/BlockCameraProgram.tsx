import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { decodeEventLog, hexToString, zeroAddress, zeroHash, type Address, type Hex } from 'viem'
import { getBlockSnapshot, subscribeBlocks } from '../chain/blocks'
import { config } from '../chain/config'
import { useMonadHardware } from '../chain/monadHardware'
import { readHeavy, readMany } from '../chain/readMany'
import { useRefreshTick } from '../chain/refreshTick'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { scanOwnedLabs } from '../frames/LabsFolder'
import { R3TARDS_BLOCK_CAMERA_ABI, R3TARDS_LABS_ABI, R3TARDS_PAINT_ABI } from '../lib/generated/abi'
import { readLabsToken, type LabsTokenData } from '../labs/labsToken'
import { errorText, labAddress } from '../labs/labCommon'
import { playSound } from '../os/sound'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { HardwareBus } from '../os/ui/HardwareBus'
import { IntroBar } from '../os/ui/IntroBar'
import { SafeImage } from '../os/ui/SafeImage'
import './monadhw.css'

const RULES = [
  'the viewfinder turns the current block context into a deterministic 32×32 portrait: validator glyph, epoch pattern, parent-hash stars, block barcode and your corner mark.',
  'capture reads epoch and proposer with CALL inside the capture transaction, then mints the result through the existing r3tards labs collection.',
  'proposer identity is provenance and art only. validators influence inclusion, so it is never treated as randomness.',
] as const

type RollItem = { id: bigint; data?: LabsTokenData }

function svgDataUri(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function BlockCameraProgram() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const block = useSyncExternalStore(subscribeBlocks, getBlockSnapshot)
  const refreshTick = useRefreshTick(10)
  const hw = useMonadHardware()
  const [address, setAddress] = useState<Address>()
  const [missing, setMissing] = useState(false)
  const [labs, setLabs] = useState<Address>()
  const [season, setSeason] = useState(0n)
  const [preview, setPreview] = useState('')
  const [quote, setQuote] = useState<ActionQuote>()
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [captured, setCaptured] = useState<RollItem>()
  const [roll, setRoll] = useState<RollItem[]>([])

  useEffect(() => {
    void labAddress('block-camera')
      .then(setAddress)
      .catch(() => setMissing(true))
  }, [])

  const refreshBasics = useCallback(async () => {
    if (!address) return
    try {
      const calls = [
        { address, abi: R3TARDS_BLOCK_CAMERA_ABI, functionName: 'LABS' },
        ...(config.paintAddress
          ? [{ address: config.paintAddress, abi: R3TARDS_PAINT_ABI, functionName: 'currentSeason' }]
          : []),
      ]
      const rows = await readMany(calls, { allowFailure: false })
      setLabs(rows[0] as Address)
      if (rows[1] != null) setSeason(BigInt(rows[1] as bigint))
    } catch (error) {
      setMessage(errorText(error))
    }
  }, [address])

  useEffect(() => {
    void refreshBasics()
  }, [refreshBasics, refreshTick])

  const proposerKnown = hw.staking.proposerValId.value != null && hw.staking.status === 'present'
  const epochKnown = hw.staking.epoch.value != null && hw.staking.status === 'present'
  // Sample the head once per refresh tick: previewPortrait is a ~4.6M-gas eth_call, far too heavy per block.
  const frame = useMemo(() => {
    const head = getBlockSnapshot()
    return { block: head.block, hash: head.hash }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick])
  const previewArgs = useMemo(
    () =>
      [
        frame.block,
        frame.hash ?? zeroHash,
        hw.staking.epoch.value ?? 0n,
        hw.staking.inDelay.value ?? false,
        epochKnown,
        hw.staking.proposerValId.value ?? 0n,
        proposerKnown,
        Number(season & 0xffffffffn),
        wallet.account ?? zeroAddress,
      ] as const,
    [
      frame,
      hw.staking.epoch.value,
      hw.staking.inDelay.value,
      hw.staking.proposerValId.value,
      epochKnown,
      proposerKnown,
      season,
      wallet.account,
    ],
  )

  useEffect(() => {
    if (!address) return
    let cancelled = false
    void readHeavy([
      {
        address,
        abi: R3TARDS_BLOCK_CAMERA_ABI,
        functionName: 'previewPortrait',
        args: previewArgs,
      },
    ])
      .then((rows) => {
        if (cancelled || rows[0]?.status !== 'success') return
        setPreview(hexToString(rows[0].result as Hex))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [address, previewArgs])

  useEffect(() => {
    if (!address || !wallet.account) {
      setQuote(undefined)
      return
    }
    let cancelled = false
    // Re-quote on the refresh tick, not every block: a 300 ms re-quote never finished and cost 3+ calls/block.
    // The last quote stays usable meanwhile; sendAction re-quotes stale quotes itself.
    void quoteAction({
      kind: 'estimate',
      address,
      abi: R3TARDS_BLOCK_CAMERA_ABI,
      functionName: 'capture',
      account: wallet.account,
      action: 'capture block portrait',
    })
      .then((next) => !cancelled && setQuote(next))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [address, wallet.account, refreshTick])

  const loadRoll = useCallback(async () => {
    if (!wallet.account || !labs || !address) return
    try {
      const ids = await scanOwnedLabs(labs, wallet.account)
      if (!ids.length) {
        setRoll([])
        return
      }
      const sources = await readMany(
        ids.map((id) => ({
          address: labs,
          abi: R3TARDS_LABS_ABI,
          functionName: 'sourceOf',
          args: [id],
        })),
        { allowFailure: true },
      )
      const owned = ids.filter((_, index) => {
        const row = sources[index] as any
        return row?.status === 'success' && String(row.result).toLowerCase() === address.toLowerCase()
      })
      const shown = owned.slice(-6).reverse()
      const next: RollItem[] = []
      for (const id of shown) next.push({ id, data: await readLabsToken(id).catch(() => undefined) })
      setRoll(next)
    } catch {
      // The roll is secondary; capture stays usable if archival reads fail.
    }
  }, [wallet.account, labs, address])

  useEffect(() => {
    void loadRoll()
  }, [loadRoll, refreshTick])

  async function capture() {
    if (!address || !wallet.account || !quote) return
    setPending(true)
    setMessage('')
    try {
      playSound('confirm')
      const result = await sendAction({
        kind: 'estimate',
        address,
        abi: R3TARDS_BLOCK_CAMERA_ABI,
        functionName: 'capture',
        account: wallet.account,
        quote,
        action: 'capture block portrait',
        successSound: 'success-heavy',
      })
      let tokenId: bigint | undefined
      for (const log of result.receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: R3TARDS_BLOCK_CAMERA_ABI,
            data: log.data,
            topics: log.topics,
          })
          if (decoded.eventName === 'Captured') {
            tokenId = BigInt((decoded.args as { tokenId: bigint }).tokenId)
            break
          }
        } catch {
          // Labs also emits logs in the same receipt.
        }
      }
      if (tokenId != null) {
        const data = await readLabsToken(tokenId, result.blockNumber).catch(() => undefined)
        setCaptured({ id: tokenId, data })
        setMessage(`captured labs #${tokenId}`)
      } else {
        setMessage('capture confirmed')
      }
      await loadRoll()
    } catch (error) {
      setMessage(errorText(error))
    } finally {
      setPending(false)
    }
  }

  if (missing)
    return (
      <div className="monadhw-program">
        <p>Block Camera is not deployed on this network.</p>
      </div>
    )

  return (
    <div className="monadhw-program block-camera-program">
      <IntroBar
        lead="photograph a block instead of a place."
        monad="the image is made from live consensus context captured inside the mint transaction."
        rules={RULES}
      />
      <HardwareBus highlight={['consensus', 'clock']} />
      {hw.staking.status === 'absent' && (
        <div className="hw-banner warning">
          this chain has no staking device: proposer and epoch record as unknown.
        </div>
      )}

      <div className="monadhw-scroll camera-layout">
        <GroupBox title="Live viewfinder">
          <div className="camera-viewfinder sunken">
            {preview ? (
              <img src={svgDataUri(preview)} alt="live block portrait preview" />
            ) : (
              <span>acquiring block…</span>
            )}
          </div>
          <div className="hw-stat-grid">
            <span>head</span>
            <b>{block.block.toString()}</b>
            <span>parent hash candidate</span>
            <code>{block.hash ? `${block.hash.slice(0, 12)}…${block.hash.slice(-6)}` : '—'}</code>
            <span>epoch</span>
            <b>{epochKnown ? hw.staking.epoch.value?.toString() : 'unknown'}</b>
            <span>proposer</span>
            <b>{proposerKnown ? `validator ${hw.staking.proposerValId.value}` : 'unknown'}</b>
            <span>season</span>
            <b>{(season + 1n).toString()}</b>
          </div>
          <div className="hw-toolbar">
            <Button primary disabled={!wallet.account || !quote || pending} onClick={() => void capture()}>
              {pending ? 'Capturing…' : 'Capture'}
            </Button>
            <span>{!wallet.account ? 'connect wallet' : (quote?.maxCost ?? 'quoting…')}</span>
          </div>
          <small>
            the viewfinder uses the current head. the minted portrait is sealed from the block that actually
            includes your capture.
          </small>
        </GroupBox>

        {captured && (
          <GroupBox title={`Latest capture · Labs #${captured.id}`}>
            <div className="camera-latest">
              {captured.data?.image && (
                <SafeImage src={captured.data.image} alt={captured.data.name} width={128} height={128} />
              )}
              <div>
                <b>{captured.data?.name ?? `Labs #${captured.id}`}</b>
                <p>block {String(captured.data?.attributes.Block ?? '—')}</p>
                <p>{String(captured.data?.attributes.Proposer ?? '—')}</p>
              </div>
            </div>
          </GroupBox>
        )}

        <GroupBox title="Your roll">
          {!wallet.account ? (
            <p>connect a wallet to load your captures.</p>
          ) : !roll.length ? (
            <p>no Block Camera captures yet.</p>
          ) : (
            <div className="camera-roll">
              {roll.map((item) => (
                <article key={item.id.toString()}>
                  {item.data?.image && (
                    <SafeImage src={item.data.image} alt={item.data.name} width={64} height={64} />
                  )}
                  <b>#{item.id.toString()}</b>
                  <span>block {String(item.data?.attributes.Block ?? '—')}</span>
                </article>
              ))}
            </div>
          )}
        </GroupBox>
        {message && <p className="hw-message">{message}</p>}
      </div>
    </div>
  )
}
