import './frames.css'
import { screenSafeMessage } from '../chain/errors'
import { safeRouteInt } from '../lib/route'
import { confirmHigherCost } from '../os/confirm'
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { Address } from 'viem'
import { publicClient } from '../chain/clients'
import { config } from '../chain/config'
import { markProgramDataReady } from '../chain/perf'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { R3OS_PAINT_ABI } from '../lib/generated/abi'
import { closeWindow } from '../os/windows'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { Tabs } from '../os/ui/Tabs'
import { subscribeCanvasActivity } from '../paint/canvasStore'
import {
  getDiffImage,
  getFrameImage,
  getOnchainDf1,
  getSiteDf1,
  getTimelapseImage,
  paletteLabel,
  rendererList,
  tokenRenderer,
  verifyDf1,
  type Df1Verification,
  type PixelImage,
  type RendererInfo,
} from './frameImage'
import { getFrameInfo, type FrameInfo } from './framesStore'
import { PixelPreview } from './PixelPreview'

const RENDERER_COPY: Record<string, string> = {
  'built-in': 'the original 256 × 256 frame',
  diff: 'lights up pixels that changed since the previous frame',
  'season timelapse': 'finales only · up to 4 sampled records',
  df1: 'exact DF1 v1 · 64 × 64 · fully onchain',
}

function short(address?: string | null) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—'
}

function hashParams() {
  return new URLSearchParams(location.hash.split('?')[1] ?? '')
}

function useRouteParams() {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const listener = () => setVersion((value) => value + 1)
    window.addEventListener('hashchange', listener)
    return () => window.removeEventListener('hashchange', listener)
  }, [])
  return useMemo(() => {
    void version
    return hashParams()
  }, [version])
}

async function readOwner(tokenId: number) {
  if (!publicClient || !config.paintAddress) return undefined
  try {
    return (await publicClient.readContract({
      address: config.paintAddress,
      abi: R3OS_PAINT_ABI,
      functionName: 'ownerOf',
      args: [BigInt(tokenId)],
    })) as Address
  } catch {
    return null
  }
}

async function rendererPreview(renderer: RendererInfo, tokenId: number, info: FrameInfo) {
  const name = renderer.name.toLowerCase()
  if (name === 'built-in') return { image: await getFrameImage(tokenId) }
  if (name === 'diff') return { image: await getDiffImage(tokenId, info) }
  if (name === 'df1') return { image: await getOnchainDf1(tokenId) }
  if (name === 'season timelapse') return { uri: await getTimelapseImage(tokenId) }
  return { image: await getFrameImage(tokenId) }
}

export function FramePropsDialog() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const params = useRouteParams()
  const tokenId = safeRouteInt(params.get('token'))
  const initialTab = params.get('tab')
  const [tab, setTab] = useState(initialTab === 'Renderer' || initialTab === 'DF1' ? initialTab : 'General')
  const [info, setInfo] = useState<FrameInfo>()
  const [owner, setOwner] = useState<Address | null>()
  const [image, setImage] = useState<PixelImage>()
  const [renderers, setRenderers] = useState<RendererInfo[]>([])
  const [currentRenderer, setCurrentRenderer] = useState(0)
  const [choice, setChoice] = useState(0)
  const [preview, setPreview] = useState<PixelImage>()
  const [previewUri, setPreviewUri] = useState<string>()
  const [quote, setQuote] = useState<ActionQuote>()
  const [setting, setSetting] = useState(false)
  const [rendererNote, setRendererNote] = useState('')
  const [onchainDf1, setOnchainDf1] = useState<PixelImage>()
  const [siteDf1, setSiteDf1] = useState<PixelImage & { seed: number; amount: number }>()
  const [verification, setVerification] = useState<Df1Verification>()
  const [verifying, setVerifying] = useState(false)
  const [royalty, setRoyalty] = useState('5% (ERC-2981)')

  useEffect(() => {
    const requested = params.get('tab')
    if (requested === 'General' || requested === 'Renderer' || requested === 'DF1') setTab(requested)
  }, [params])

  const [loadError, setLoadError] = useState('')

  const loadBase = useCallback(async () => {
    if (tokenId <= 0) return
    setLoadError('')
    let loaded
    try {
      loaded = await Promise.all([
        getFrameInfo(tokenId),
        readOwner(tokenId),
        getFrameImage(tokenId),
        rendererList(),
      ])
    } catch (error) {
      // A deep link or Run… `frame <id>` can name a frame that was never minted.
      const text = screenSafeMessage(error)
      setInfo(undefined)
      setLoadError(
        /FrameDoesNotExist|nonexistent|does not exist/i.test(text)
          ? `frame #${tokenId} does not exist.`
          : `could not read frame #${tokenId}.`,
      )
      return
    }
    const [frame, frameOwner, frameImage, list] = loaded
    if (!frame) return
    setInfo(frame)
    setOwner(frameOwner)
    setImage(frameImage)
    setRenderers(list)
    const current = await tokenRenderer(tokenId).catch(() => 0)
    setCurrentRenderer(current)
    const requested = params.get('renderer')
    const requestedRenderer = requested
      ? list.find((item) => item.name.toLowerCase().includes(requested.toLowerCase()))
      : undefined
    setChoice(requestedRenderer?.id ?? current)
    markProgramDataReady('frame-props')
    if (publicClient && config.paintAddress) {
      const value = (await publicClient.readContract({
        address: config.paintAddress,
        abi: R3OS_PAINT_ABI,
        functionName: 'royaltyInfo',
        args: [BigInt(tokenId), 10_000n],
      })) as readonly [Address, bigint]
      setRoyalty(`${Number(value[1]) / 100}% (ERC-2981)`)
    }
  }, [tokenId, params])

  useEffect(() => {
    void loadBase().catch(() => undefined)
  }, [loadBase])

  useEffect(
    () =>
      subscribeCanvasActivity((activity) => {
        if (activity.eventName === 'TokenRendererSet' && Number(activity.tokenId) === tokenId) {
          void tokenRenderer(tokenId).then((value) => {
            setCurrentRenderer(value)
            setChoice(value)
          })
        }
      }),
    [tokenId],
  )

  const selectedRenderer = renderers.find((renderer) => renderer.id === choice)
  const owns = Boolean(wallet.account && owner && wallet.account.toLowerCase() === owner.toLowerCase())
  const canSet = owns && choice !== currentRenderer && selectedRenderer != null
  const timelapseDisabled = selectedRenderer?.name.toLowerCase() === 'season timelapse' && !info?.finale

  useEffect(() => {
    if (tab !== 'Renderer' || !selectedRenderer || !info || timelapseDisabled) return
    let cancelled = false
    setPreview(undefined)
    setPreviewUri(undefined)
    void rendererPreview(selectedRenderer, tokenId, info)
      .then((value) => {
        if (cancelled) return
        setPreview(value.image)
        setPreviewUri(value.uri)
      })
      .catch(() => {
        if (!cancelled) setPreview(image)
      })
    return () => {
      cancelled = true
    }
  }, [tab, selectedRenderer, info, timelapseDisabled, tokenId, image])

  useEffect(() => {
    if (tab !== 'Renderer' || !canSet || !wallet.account || !config.paintAddress) {
      setQuote(undefined)
      return
    }
    let cancelled = false
    void quoteAction({
      kind: 'estimate',
      address: config.paintAddress,
      abi: R3OS_PAINT_ABI,
      functionName: 'setTokenRenderer',
      args: [BigInt(tokenId), BigInt(choice)],
      account: wallet.account,
      action: `set renderer for frame #${tokenId}`,
    })
      .then((value) => {
        if (!cancelled) setQuote(value)
      })
      .catch(() => {
        if (!cancelled) setQuote(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [tab, canSet, wallet.account, tokenId, choice])

  useEffect(() => {
    if (tab !== 'DF1' || tokenId <= 0) return
    let cancelled = false
    void Promise.all([getOnchainDf1(tokenId), getSiteDf1(tokenId)])
      .then(([chain, site]) => {
        if (cancelled) return
        setOnchainDf1(chain)
        setSiteDf1(site)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [tab, tokenId])

  async function setRenderer() {
    if (!wallet.account || !config.paintAddress || !quote || !canSet) return
    setSetting(true)
    try {
      await sendAction({
        kind: 'estimate',
        address: config.paintAddress,
        abi: R3OS_PAINT_ABI,
        functionName: 'setTokenRenderer',
        args: [BigInt(tokenId), BigInt(choice)],
        account: wallet.account,
        quote,
        action: `set renderer for frame #${tokenId}`,
        confirmHigherCost,
      })
      setCurrentRenderer(choice)
      setRendererNote('renderer set · marketplaces refresh on MetadataUpdate')
    } catch (error) {
      setRendererNote(screenSafeMessage(error))
    } finally {
      setSetting(false)
    }
  }

  async function runVerification() {
    setVerifying(true)
    try {
      setVerification(await verifyDf1(tokenId))
    } finally {
      setVerifying(false)
    }
  }

  if (!tokenId) return <div className="frame-props-empty">select a saved frame first.</div>

  return (
    <div className="frame-props">
      <Tabs tabs={['General', 'Renderer', 'DF1']} active={tab} onChange={setTab} />
      <div className="frame-props-body">
        {loadError && <p className="frame-props-empty">{loadError}</p>}
        {tab === 'General' && info && (
          <div className="frame-general">
            <div className="frame-general-thumb sunken">
              <PixelPreview image={image} size={120} />
            </div>
            <dl>
              <dt>token</dt>
              <dd>
                frame #{tokenId} · season {info.season + 1}
              </dd>
              <dt>minter</dt>
              <dd>{short(info.minter)}</dd>
              <dt>block</dt>
              <dd>{info.blockNumber.toString()}</dd>
              <dt>sealed by</dt>
              <dd>{short(info.proposer)} (block.coinbase)</dd>
              <dt>DF1</dt>
              <dd>{Math.max(100, info.df1Amount)}%</dd>
              <dt>face / bg</dt>
              <dd>
                {paletteLabel(info.faceColor)} / {paletteLabel(info.backgroundColor)}
              </dd>
              <dt>royalty</dt>
              <dd>{royalty}</dd>
              <dt>owner</dt>
              <dd>{owner == null ? 'burned' : owns ? 'you' : short(owner)}</dd>
            </dl>
          </div>
        )}

        {tab === 'Renderer' && info && (
          <div className="renderer-tab">
            <p>
              Pick how marketplaces draw frame #{tokenId}. Only the holder can change this, and the choice
              moves with the token.
            </p>
            <div className="renderer-layout">
              <GroupBox title="Renderer">
                <div className="renderer-options">
                  {renderers.map((renderer) => {
                    const disabled = renderer.name.toLowerCase() === 'season timelapse' && !info.finale
                    return (
                      <label key={renderer.id} className={choice === renderer.id ? 'selected' : ''}>
                        <input
                          type="radio"
                          name="renderer"
                          checked={choice === renderer.id}
                          disabled={disabled}
                          onChange={() => setChoice(renderer.id)}
                        />
                        <span>
                          <b>
                            {renderer.name} (id {renderer.id})
                          </b>
                          <small>
                            {RENDERER_COPY[renderer.name.toLowerCase()] ?? 'registered onchain renderer'}
                          </small>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </GroupBox>
              <div className="renderer-preview sunken">
                {previewUri ? (
                  <img src={previewUri} alt="renderer preview" width={184} height={184} />
                ) : (
                  <PixelPreview image={preview} size={184} />
                )}
                <small>preview</small>
              </div>
            </div>
            <div className="renderer-action">
              <Button
                primary
                disabled={!canSet || timelapseDisabled || !quote || setting}
                title={!owns ? 'only the holder can change this' : undefined}
                onClick={() => void setRenderer()}
              >
                Set renderer
              </Button>
              <small>
                {rendererNote ||
                  (!owns
                    ? 'only the holder can change this'
                    : choice === currentRenderer
                      ? 'current renderer'
                      : quote
                        ? `max fee ${quote.maxCost.replace(' max', '')} · holder only`
                        : 'quoting…')}
              </small>
            </div>
          </div>
        )}

        {tab === 'DF1' && info && (
          <div className="df1-tab">
            <div className="df1-pair">
              <div>
                <h3>onchain DF1</h3>
                <div className="sunken">
                  <PixelPreview image={onchainDf1} size={220} />
                </div>
                <small>exact v1 · 64 × 64 · what marketplaces show</small>
              </div>
              <div>
                <h3>site preview</h3>
                <div className="sunken">
                  <PixelPreview image={siteDf1} size={220} />
                </div>
                <small>256 × 256 · rendered here, not onchain</small>
              </div>
            </div>
            <p className="df1-seed">
              seed df1Seed({tokenId}) = {siteDf1 ? `0x${siteDf1.seed.toString(16).padStart(8, '0')}` : '…'} ·
              amount {siteDf1?.amount ?? Math.max(100, info.df1Amount)}% (
              {Math.max(100, info.df1Amount) >= 200
                ? 'storm frame'
                : 'calm frame; storm frames render at 200%'}
              )
            </p>
            <Button onClick={() => void runVerification()} disabled={verifying}>
              {verifying ? 'Verifying…' : 'Verify DF1'}
            </Button>
            {verification && (
              <p className={verification.matched === verification.total ? 'verify-ok' : 'verify-bad'}>
                {verification.matched.toLocaleString()} of {verification.total.toLocaleString()} bytes match
                df1Rgb64
                {verification.firstMismatch == null
                  ? ''
                  : ` · first mismatch offset ${verification.firstMismatch}`}
              </p>
            )}
          </div>
        )}
      </div>
      <div className="dialog-actions frame-props-actions">
        <Button primary onClick={() => closeWindow('frame-props')}>
          OK
        </Button>
        <Button onClick={() => closeWindow('frame-props')}>Cancel</Button>
      </div>
    </div>
  )
}
