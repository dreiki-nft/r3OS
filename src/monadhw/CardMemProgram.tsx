import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { bytesToHex, encodeFunctionData, hexToBytes, type Address, type Hex } from 'viem'
import { publicClient } from '../chain/clients'
import {
  CARD_PAGE_BYTES,
  CARD_PAGE_WORDS,
  MONAD_CARD_ABI,
  changedCardWordRange,
  decodeAscii,
  decodeHeader,
  encodeAscii,
  isOfficialCard,
  nonStandardReserved,
  notifyMonadCardChanged,
  packCardIcon,
  regionOf,
  rememberCardId,
  unpackCardIcon,
  useMonadCard,
  usedBytes,
} from '../chain/monadCard'
import { config } from '../chain/config'
import { readHeavy, readMany } from '../chain/readMany'
import { quoteAction, sendAction, type ActionQuote } from '../chain/tx'
import { getWalletSnapshot, subscribeWallet } from '../chain/wallet'
import { R3TARDS_CARD_MEMORY_ABI } from '../lib/generated/abi'
import { PALETTE } from '../lib/palette'
import { errorText, sameAddress, shortAddress } from '../labs/labCommon'
import { Button } from '../os/ui/Button'
import { GroupBox } from '../os/ui/GroupBox'
import { HardwareBus } from '../os/ui/HardwareBus'
import { IntroBar } from '../os/ui/IntroBar'
import { hexdumpRows } from './page'
import './monadhw.css'

const RULES = [
  "only the card's current owner can write. approvals, Paint session keys and signatures do not count.",
  'everything written here is public contract storage and the CardWritten events preserve the write history forever.',
  'CARD.DRV never modifies the Monad Card contract. the card only decides who is allowed to program this separate page.',
] as const

const ZERO_WORD = `0x${'00'.repeat(32)}` as Hex

function parseCardId(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  try {
    const id = BigInt(trimmed)
    return id >= 0n ? id : undefined
  } catch {
    return undefined
  }
}

function wordsToUserHex(words: readonly Hex[]) {
  const bytes = new Uint8Array(96 * 32)
  words.slice(32, 128).forEach((word, index) => bytes.set(hexToBytes(word), index * 32))
  let end = bytes.length
  while (end > 0 && bytes[end - 1] === 0) end--
  return bytesToHex(bytes.slice(0, end)).slice(2)
}

function userHexToWords(value: string) {
  const clean = value.replace(/\s+/g, '').replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error('user memory must be hex')
  if (clean.length % 2) throw new Error('user memory needs complete bytes')
  if (clean.length > 3072 * 2) throw new Error('user memory is limited to 3,072 bytes')
  const bytes = clean ? hexToBytes(`0x${clean}` as Hex) : new Uint8Array()
  const padded = new Uint8Array(3072)
  padded.set(bytes)
  return Array.from({ length: 96 }, (_, index) =>
    bytesToHex(padded.slice(index * 32, index * 32 + 32)),
  ) as Hex[]
}

function flagsWord(bootBanner: boolean, accent: number) {
  const bytes = new Uint8Array(32)
  bytes[0] = bootBanner ? 1 : 0
  bytes[1] = accent < 0 ? 0 : accent + 1
  return bytesToHex(bytes)
}

function decodeFlags(word: Hex) {
  const bytes = hexToBytes(word)
  const accent = bytes[1] >= 1 && bytes[1] <= 16 ? bytes[1] - 1 : -1
  return { bootBanner: Boolean(bytes[0] & 1), accent }
}

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

function mintedCardId(
  logs: readonly { address: string; topics: readonly Hex[] }[],
  card: Address,
  owner: Address,
) {
  for (const log of logs) {
    const [topic, from, to, id] = log.topics
    if (!sameAddress(log.address as Address, card) || topic !== TRANSFER_TOPIC || id == null || to == null)
      continue
    if (BigInt(from ?? '0x0') !== 0n || !sameAddress(`0x${to.slice(26)}` as Address, owner)) continue
    return BigInt(id)
  }
  return undefined
}

function IconEditor({
  pixels,
  colour,
  editable,
  onPaint,
}: {
  pixels: Uint8Array
  colour: number
  editable: boolean
  onPaint: (x: number, y: number, colour: number) => void
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const painting = useRef(false)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        ctx.fillStyle = PALETTE[pixels[y * 32 + x] ?? 0]?.hex ?? '#fff'
        ctx.fillRect(x, y, 1, 1)
      }
    }
  }, [pixels])

  const draw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!editable) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min(31, Math.floor(((event.clientX - rect.left) / rect.width) * 32)))
    const y = Math.max(0, Math.min(31, Math.floor(((event.clientY - rect.top) / rect.height) * 32)))
    onPaint(x, y, colour)
  }

  return (
    <canvas
      ref={ref}
      width={32}
      height={32}
      className={`card-icon-editor ${editable ? 'editable' : ''}`}
      onPointerDown={(event) => {
        if (!editable) return
        painting.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
        draw(event)
      }}
      onPointerMove={(event) => painting.current && draw(event)}
      onPointerUp={(event) => {
        painting.current = false
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onPointerCancel={() => {
        painting.current = false
      }}
    />
  )
}

type WriteLog = { block: bigint; from: number; to: number; gasUsed: bigint; status: string }

function normalizeCardInfo(raw: any) {
  if (!raw) return undefined
  return {
    owner: (raw.owner ?? raw[0]) as Address,
    exists: Boolean(raw.exists ?? raw[1]),
    pageBaseSlot: BigInt(raw.pageBaseSlot ?? raw[2]),
    pageIndex: BigInt(raw.pageIndex ?? raw[3]),
    formatted: Boolean(raw.formatted ?? raw[4]),
    version: Number(raw.version ?? raw[5]),
    writes: Number(raw.writes ?? raw[6]),
    firstWriteBlock: BigInt(raw.firstWriteBlock ?? raw[7]),
    lastWriteBlock: BigInt(raw.lastWriteBlock ?? raw[8]),
  }
}

export function CardMemProgram() {
  const wallet = useSyncExternalStore(subscribeWallet, getWalletSnapshot)
  const card = useMonadCard()
  const [cardIdText, setCardIdText] = useState('')
  const [cardId, setCardId] = useState<bigint>()
  const [owner, setOwner] = useState<Address>()
  const [ownerIsContract, setOwnerIsContract] = useState(false)
  const [viewInfo, setViewInfo] = useState<ReturnType<typeof normalizeCardInfo>>()
  const [originalWords, setOriginalWords] = useState<Hex[]>(Array(CARD_PAGE_WORDS).fill(ZERO_WORD))
  const [label, setLabel] = useState('')
  const [messageText, setMessageText] = useState('')
  const [icon, setIcon] = useState(new Uint8Array(1024))
  const [colour, setColour] = useState(1)
  const [bootBanner, setBootBanner] = useState(false)
  const [accent, setAccent] = useState(-1)
  const [userHex, setUserHex] = useState('')
  const [raw, setRaw] = useState(false)
  const [quote, setQuote] = useState<ActionQuote>()
  const [pending, setPending] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')
  const [writeLog, setWriteLog] = useState<WriteLog[]>([])
  const routeCard = useRef(false)

  useEffect(() => {
    // `#/card-mem?card=<id>` on open, and again when Run… or a link changes the hash while CARDMEM is open.
    const route = () => {
      const query = window.location.hash.split('?')[1] ?? ''
      if (!window.location.hash.startsWith('#/card-mem')) return
      const value = new URLSearchParams(query).get('card')
      if (!value) return
      const id = parseCardId(value)
      if (id == null) return
      routeCard.current = true
      setCardId(id)
      setCardIdText(id.toString())
    }
    route()
    window.addEventListener('hashchange', route)
    return () => window.removeEventListener('hashchange', route)
  }, [])

  useEffect(() => {
    if (!routeCard.current && card.status === 'present' && card.cardId != null) {
      setCardId(card.cardId)
      setCardIdText(card.cardId.toString())
    }
  }, [card.status, card.cardId])

  const loadPage = useCallback(
    async (nextId = cardId) => {
      if (!card.driverAddress || nextId == null) return
      try {
        const [meta, pageRows] = await Promise.all([
          readMany(
            [
              {
                address: card.driverAddress,
                abi: R3TARDS_CARD_MEMORY_ABI,
                functionName: 'cardOwner',
                args: [nextId],
              },
              {
                address: card.driverAddress,
                abi: R3TARDS_CARD_MEMORY_ABI,
                functionName: 'cardInfo',
                args: [nextId],
              },
            ],
            { allowFailure: true },
          ),
          readHeavy([
            {
              address: card.driverAddress,
              abi: R3TARDS_CARD_MEMORY_ABI,
              functionName: 'readPage',
              args: [nextId],
            },
          ]),
        ])
        const ownerRow = meta[0] as any
        const infoRow = meta[1] as any
        const nextInfo = infoRow?.status === 'success' ? normalizeCardInfo(infoRow.result) : undefined
        setViewInfo(nextInfo)
        const nextOwner =
          ownerRow?.status === 'success'
            ? ((ownerRow.result as readonly [Address, boolean])[0] as Address)
            : undefined
        const exists =
          ownerRow?.status === 'success'
            ? Boolean((ownerRow.result as readonly [Address, boolean])[1])
            : false
        setOwner(exists ? nextOwner : undefined)
        if (publicClient && exists && nextOwner) {
          const code = await publicClient.getCode({ address: nextOwner }).catch(() => undefined)
          setOwnerIsContract(Boolean(code && code !== '0x'))
        } else {
          setOwnerIsContract(false)
        }
        const pageRow = pageRows[0]
        if (pageRow?.status !== 'success') throw pageRow?.error ?? new Error('card page read failed')
        const words = [...(pageRow.result as readonly Hex[])]
        setOriginalWords(words)
        setLabel(decodeAscii(words.slice(1, 2), 32))
        setIcon(unpackCardIcon(words.slice(2, 18)))
        setMessageText(decodeAscii(words.slice(18, 22), 128))
        const flags = decodeFlags(words[22] ?? ZERO_WORD)
        setBootBanner(flags.bootBanner)
        setAccent(flags.accent)
        setUserHex(wordsToUserHex(words))
        setStatusMessage(exists ? '' : `Card #${nextId} does not exist.`)
      } catch (error) {
        setStatusMessage(errorText(error))
      }
    },
    [card.driverAddress, cardId],
  )

  useEffect(() => {
    void loadPage()
  }, [loadPage])

  const draft = useMemo(() => {
    const words = [...originalWords]
    while (words.length < CARD_PAGE_WORDS) words.push(ZERO_WORD)
    try {
      words[1] = encodeAscii(label, 32, 1)[0]
      packCardIcon(icon).forEach((word, index) => {
        words[2 + index] = word
      })
      encodeAscii(messageText, 128, 4).forEach((word, index) => {
        words[18 + index] = word
      })
      words[22] = flagsWord(bootBanner, accent)
      userHexToWords(userHex).forEach((word, index) => {
        words[32 + index] = word
      })
      return { words, error: '' }
    } catch (error) {
      return { words, error: errorText(error) }
    }
  }, [originalWords, label, icon, messageText, bootBanner, accent, userHex])

  const range = useMemo(() => changedCardWordRange(originalWords, draft.words), [originalWords, draft.words])
  const editable = Boolean(owner && wallet.account && sameAddress(owner, wallet.account))
  const header = decodeHeader(originalWords[0] ?? ZERO_WORD)
  const used = usedBytes(originalWords)
  const reserved = nonStandardReserved(originalWords)
  const info = viewInfo ?? (card.cardId === cardId ? card.cardInfo : undefined)

  useEffect(() => {
    setQuote(undefined)
    if (!card.driverAddress || !wallet.account || !editable || !range || draft.error) return
    let cancelled = false
    void quoteAction({
      kind: 'estimate',
      address: card.driverAddress,
      abi: R3TARDS_CARD_MEMORY_ABI,
      functionName: 'write',
      args: [cardId!, BigInt(range.offset), range.words],
      account: wallet.account,
      action: `program CARD.DRV #${cardId}`,
    })
      .then((next) => !cancelled && setQuote(next))
      .catch((error) => !cancelled && setStatusMessage(`cannot quote write: ${errorText(error)}`))
    return () => {
      cancelled = true
    }
  }, [card.driverAddress, wallet.account, editable, range, draft.error, cardId])

  async function identify() {
    if (!card.cardAddress || !wallet.account) return
    const id = parseCardId(cardIdText)
    if (id == null) {
      setStatusMessage('enter a valid non-negative card number')
      return
    }
    try {
      const rows = await readMany(
        [{ address: card.cardAddress, abi: MONAD_CARD_ABI, functionName: 'ownerOf', args: [id] }],
        { allowFailure: true },
      )
      const row = rows[0] as any
      if (row?.status !== 'success' || !sameAddress(row.result as Address, wallet.account)) {
        setStatusMessage(`Card #${id} is not owned by this wallet.`)
        return
      }
      rememberCardId(config.chainId, wallet.account, id)
      setCardId(id)
      setStatusMessage(`Found hardware: Card #${id}`)
      await loadPage(id)
    } catch (error) {
      setStatusMessage(errorText(error))
    }
  }

  async function viewCard() {
    const id = parseCardId(cardIdText)
    if (id == null) {
      setStatusMessage('enter a valid card number')
      return
    }
    setCardId(id)
    await loadPage(id)
  }

  async function claimMock() {
    if (!card.cardAddress || !wallet.account) return
    setPending(true)
    setStatusMessage('')
    try {
      const claimQuote = await quoteAction({
        kind: 'estimate',
        address: card.cardAddress,
        abi: MONAD_CARD_ABI,
        functionName: 'claim',
        account: wallet.account,
        action: 'claim mock Monad Card',
      })
      const result = await sendAction({
        kind: 'estimate',
        address: card.cardAddress,
        abi: MONAD_CARD_ABI,
        functionName: 'claim',
        account: wallet.account,
        quote: claimQuote,
        action: 'claim mock Monad Card',
        successSound: 'success-heavy',
      })
      // The mint's ERC-721 Transfer(0, wallet, id) names the new card; remember it so the
      // slot shows the card straight away instead of the Found New Hardware wizard.
      const minted = mintedCardId(result.receipt.logs, card.cardAddress, wallet.account)
      if (minted != null) {
        rememberCardId(config.chainId, wallet.account, minted)
        setCardIdText(minted.toString())
      }
      notifyMonadCardChanged()
      setStatusMessage(minted != null ? `mock card #${minted} claimed` : 'mock card claimed')
    } catch (error) {
      setStatusMessage(errorText(error))
    } finally {
      setPending(false)
    }
  }

  async function writeCard() {
    if (!card.driverAddress || !wallet.account || cardId == null || !range || !quote) return
    setPending(true)
    setStatusMessage('')
    try {
      const result = await sendAction({
        kind: 'estimate',
        address: card.driverAddress,
        abi: R3TARDS_CARD_MEMORY_ABI,
        functionName: 'write',
        args: [cardId, BigInt(range.offset), range.words],
        account: wallet.account,
        quote,
        action: `program CARD.DRV #${cardId}`,
        successSound: 'success-heavy',
      })
      setWriteLog((current) =>
        [
          {
            block: result.blockNumber,
            from: range.offset,
            to: range.offset + range.words.length - 1,
            gasUsed: result.receipt.gasUsed,
            status: result.receipt.status,
          },
          ...current,
        ].slice(0, 12),
      )
      rememberCardId(config.chainId, wallet.account, cardId)
      notifyMonadCardChanged()
      setStatusMessage(`wrote words ${range.offset}–${range.offset + range.words.length - 1}`)
      await loadPage(cardId)
    } catch (error) {
      setStatusMessage(errorText(error))
    } finally {
      setPending(false)
    }
  }

  async function copyCalldata() {
    if (cardId == null || !range) return
    const data = encodeFunctionData({
      abi: R3TARDS_CARD_MEMORY_ABI,
      functionName: 'write',
      args: [cardId, BigInt(range.offset), range.words],
    })
    try {
      await navigator.clipboard.writeText(data)
      setStatusMessage('write calldata copied')
    } catch {
      setStatusMessage(data)
    }
  }

  if (!wallet.account) {
    return (
      <div className="monadhw-program cardmem-program">
        <IntroBar
          lead="EEPROM programmer for your Monad Card."
          monad="each card owns one 4 KiB storage page; the first read of a page is cold, the rest of it is warm (MIP-8)."
          rules={RULES}
        />
        <HardwareBus highlight={['card', 'storage']} />
        <div className="monadhw-scroll">
          <p>Insert card: connect a wallet.</p>
        </div>
      </div>
    )
  }

  if (!card.driverAddress) {
    return (
      <div className="monadhw-program cardmem-program">
        <IntroBar
          lead="EEPROM programmer for your Monad Card."
          monad="each card owns one 4 KiB storage page; the first read of a page is cold, the rest of it is warm (MIP-8)."
          rules={RULES}
        />
        <HardwareBus highlight={['card', 'storage']} />
        <div className="monadhw-scroll">
          <p>CARD.DRV is not deployed on this network.</p>
        </div>
      </div>
    )
  }

  const rows = hexdumpRows(draft.words)

  return (
    <div className="monadhw-program cardmem-program">
      <IntroBar
        lead="EEPROM programmer for your Monad Card."
        monad="each card owns one 4 KiB storage page; the first read of a page is cold, the rest of it is warm (MIP-8)."
        rules={RULES}
      />
      <HardwareBus highlight={['card', 'storage']} />
      <div className="monadhw-scroll">
        {card.status === 'empty' && card.cardAddress && (
          <GroupBox title="Card slot">
            <p>No Monad Card in this wallet.</p>
            <p className="hw-note">
              You can still enter any card number below to inspect its CARD.DRV page read-only.
            </p>
            {!isOfficialCard(config.chainId, card.cardAddress) && (
              <>
                <Button disabled={pending} onClick={() => void claimMock()}>
                  CLAIM MOCK CARD
                </Button>
                <small>testnet mock contract</small>
              </>
            )}
          </GroupBox>
        )}
        {card.status === 'unknown-id' && (
          <GroupBox title="Found New Hardware">
            <p>card detected, number unknown.</p>
            <div className="hw-toolbar">
              <label>
                card number{' '}
                <input value={cardIdText} onChange={(event) => setCardIdText(event.target.value)} />
              </label>
              <Button primary onClick={() => void identify()}>
                Identify
              </Button>
            </div>
          </GroupBox>
        )}

        <GroupBox title="Card slot">
          <div className="hw-toolbar">
            <label>
              card # <input value={cardIdText} onChange={(event) => setCardIdText(event.target.value)} />
            </label>
            <Button onClick={() => void viewCard()}>View</Button>
          </div>
          <div className="cardmem-overview">
            <div className="card-cartridge raised">
              <div className="card-cartridge-icon">
                <IconEditor pixels={icon} colour={colour} editable={false} onPaint={() => undefined} />
              </div>
              <b>{label || 'UNTITLED'}</b>
              <span>MONAD CARD #{cardId?.toString() ?? '—'}</span>
              <i className="card-edge" />
            </div>
            <div className="hw-stat-grid">
              <span>Capacity</span>
              <b>4,096 bytes</b>
              <span>Used</span>
              <b>{used.toLocaleString()} bytes</b>
              <span>Free</span>
              <b>{(CARD_PAGE_BYTES - used).toLocaleString()} bytes</b>
              <span>Writes</span>
              <b>{info?.writes ?? header.writes}</b>
              <span>Page</span>
              <code>{info ? `0x${info.pageIndex.toString(16)}` : '—'}</code>
              <span>Slot</span>
              <code>{info ? `0x${info.pageBaseSlot.toString(16).padStart(64, '0')}` : '—'}</code>
              <span>Owner</span>
              <code>{owner ? shortAddress(owner) : 'not found'}</code>
              <span>Last write block</span>
              <b>{info?.lastWriteBlock?.toString() ?? header.lastWriteBlock.toString()}</b>
              <span>Format</span>
              <b>{header.formatted ? `v${header.version}` : 'UNFORMATTED'}</b>
            </div>
          </div>
          {reserved.length > 0 && (
            <p className="hw-banner warning">non-standard reserved words: {reserved.join(', ')}</p>
          )}
        </GroupBox>

        {cardId != null && (
          <>
            <GroupBox title="Label · 32 ASCII bytes">
              <input
                disabled={!editable}
                maxLength={32}
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </GroupBox>

            <GroupBox title="Message · 128 ASCII bytes">
              <textarea
                disabled={!editable}
                maxLength={128}
                value={messageText}
                onChange={(event) => setMessageText(event.target.value)}
              />
              <small>{messageText.length}/128</small>
            </GroupBox>

            <GroupBox title="Icon · 32×32 · 4-bit palette">
              <IconEditor
                pixels={icon}
                colour={colour}
                editable={editable}
                onPaint={(x, y, nextColour) => {
                  setIcon((current) => {
                    const next = current.slice()
                    next[y * 32 + x] = nextColour
                    return next
                  })
                }}
              />
              <div className="page-palette">
                {PALETTE.map((entry) => (
                  <button
                    key={entry.index}
                    className={colour === entry.index ? 'selected' : ''}
                    style={{ background: entry.hex }}
                    title={entry.name}
                    onClick={() => setColour(entry.index)}
                  />
                ))}
              </div>
              <Button disabled={!editable} onClick={() => setIcon(new Uint8Array(1024))}>
                Clear icon
              </Button>
            </GroupBox>

            <GroupBox title="Flags">
              <div className="card-flags">
                <label>
                  <input
                    type="checkbox"
                    disabled={!editable}
                    checked={bootBanner}
                    onChange={(event) => setBootBanner(event.target.checked)}
                  />{' '}
                  BOOT_BANNER
                </label>
                <label>
                  accent{' '}
                  <select
                    disabled={!editable}
                    value={accent}
                    onChange={(event) => setAccent(Number(event.target.value))}
                  >
                    <option value={-1}>none</option>
                    {PALETTE.map((entry) => (
                      <option key={entry.index} value={entry.index}>
                        {entry.index} · {entry.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </GroupBox>

            <GroupBox title="User memory · 3,072 bytes">
              <textarea
                className="card-user-hex"
                disabled={!editable}
                value={userHex}
                onChange={(event) => setUserHex(event.target.value)}
                placeholder="hex bytes"
              />
              <small>
                {Math.floor(userHex.replace(/\s+/g, '').replace(/^0x/i, '').length / 2).toLocaleString()} /
                3,072 bytes
              </small>
            </GroupBox>

            <GroupBox title="Program">
              {draft.error && <p className="hw-banner warning">{draft.error}</p>}
              {ownerIsContract && !editable && owner && (
                <div className="hw-banner warning">
                  owner is a contract wallet: send this from it
                  <Button disabled={!range} onClick={() => void copyCalldata()}>
                    COPY CALLDATA
                  </Button>
                </div>
              )}
              <div className="hw-toolbar">
                <Button
                  primary
                  disabled={!editable || !range || !quote || pending || Boolean(draft.error)}
                  onClick={() => void writeCard()}
                >
                  {pending ? 'WRITING…' : 'WRITE TO CARD'}
                </Button>
                <span>
                  {!range
                    ? 'no changes'
                    : `${range.words.length} words · ${quote?.gasLimit.toLocaleString() ?? 'quoting…'} gas · ${quote?.maxCost ?? '—'}`}
                </span>
              </div>
              {!header.formatted && <small>first successful write formats this page as CARD.DRV v1.</small>}
            </GroupBox>

            <GroupBox title="RAW">
              <label>
                <input type="checkbox" checked={raw} onChange={(event) => setRaw(event.target.checked)} />{' '}
                show 128-word hexdump
              </label>
              {raw && (
                <div className="page-hexdump card-raw sunken">
                  {rows.map((row) => {
                    const changed = originalWords[row.offset] !== draft.words[row.offset]
                    return (
                      <div
                        key={row.offset}
                        className={`${changed ? 'changed' : ''} region-${regionOf(row.offset * 32)
                          .toLowerCase()
                          .replaceAll(' ', '-')}`}
                      >
                        <b>{row.offset.toString(16).padStart(2, '0')}</b>
                        <code>{row.hex}</code>
                        <span>{row.ascii}</span>
                        <em>{regionOf(row.offset * 32)}</em>
                      </div>
                    )
                  })}
                </div>
              )}
            </GroupBox>

            {writeLog.length > 0 && (
              <GroupBox title="Write log">
                <div className="card-write-log sunken">
                  {writeLog.map((row, index) => (
                    <div key={`${row.block}-${index}`}>
                      block {row.block.toString()} · words {row.from}–{row.to} ·{' '}
                      {row.gasUsed.toLocaleString()} gas · {row.status}
                    </div>
                  ))}
                </div>
              </GroupBox>
            )}
          </>
        )}
        {statusMessage && <p className="hw-message">{statusMessage}</p>}
      </div>
    </div>
  )
}
