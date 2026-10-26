/**
 * "My storm card": a 1200 × 675 image (X's card size) of one wallet's Storm Season, drawn on a canvas in the
 * browser so people can post it. Nothing is uploaded: the image is shared through the phone's share sheet or
 * downloaded. Pure layout helpers are tested; the drawing itself is plain Canvas 2D.
 */
export type CardData = {
  name: string
  address: string
  tickets: number
  pending: number
  rank?: number
  wallets: number
  caught: number[]
  pendingStorms: number[]
  counted: number
  totalStorms: number
}

export const CARD_W = 1200
export const CARD_H = 675

const BG = '#0b0b0c'
const PANEL = '#1b1b1e'
const LINE = '#3d3d44'
const TEXT = '#f2efe9'
const MUTED = '#a3a09a'
const CYAN = '#5feddf'
const YELLOW = '#fec343'
const FONT = "'IBM Plex Mono', 'Courier New', monospace"

export function cardHeadline(data: CardData) {
  const total = data.tickets + data.pending
  return `${total} storm ${total === 1 ? 'ticket' : 'tickets'}`
}

export function cardSubline(data: CardData) {
  const parts = []
  if (data.rank) parts.push(`rank #${data.rank} of ${data.wallets}`)
  const caught = [...data.caught, ...data.pendingStorms].sort((a, b) => a - b)
  if (caught.length) parts.push(`caught storm ${caught.join(', ')}`)
  return parts.join(' · ')
}

/** Square state for each of the season's storms, in order. */
export function cardSquares(data: CardData) {
  return Array.from({ length: data.totalStorms }, (_, i) => {
    const n = i + 1
    if (data.caught.includes(n) || data.pendingStorms.includes(n)) return 'caught' as const
    if (n <= data.counted) return 'missed' as const
    return 'ahead' as const
  })
}

/** The pixel bolt (same shape as the r3OS lightning icon idea), drawn as blocks of `px`. */
const BOLT = ['....##', '...##.', '..##..', '.#####', '...##.', '..##..', '.##...', '##....']
function bolt(ctx: CanvasRenderingContext2D, x: number, y: number, px: number, colour: string) {
  ctx.fillStyle = colour
  BOLT.forEach((row, r) =>
    [...row].forEach((cell, c) => cell === '#' && ctx.fillRect(x + c * px, y + r * px, px, px)),
  )
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number, size: number, weight = 700) {
  let s = size
  ctx.font = `${weight} ${s}px ${FONT}`
  while (ctx.measureText(text).width > max && s > 18) {
    s -= 2
    ctx.font = `${weight} ${s}px ${FONT}`
  }
  return s
}

export function drawCard(ctx: CanvasRenderingContext2D, data: CardData) {
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  // faint storm rain
  ctx.fillStyle = 'rgba(95, 237, 223, 0.06)'
  for (let i = 0; i < 90; i++) ctx.fillRect((i * 137) % CARD_W, (i * 89) % CARD_H, 3, 26)

  // window
  const x = 60
  const y = 50
  const w = CARD_W - 120
  const h = CARD_H - 100
  ctx.fillStyle = '#000'
  ctx.fillRect(x + 10, y + 10, w, h)
  ctx.fillStyle = PANEL
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = LINE
  ctx.lineWidth = 2
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2)
  const bar = ctx.createLinearGradient(x, 0, x + w, 0)
  bar.addColorStop(0, '#7a5a12')
  bar.addColorStop(1, '#2a2008')
  ctx.fillStyle = bar
  ctx.fillRect(x + 2, y + 2, w - 4, 52)
  bolt(ctx, x + 18, y + 10, 4, YELLOW)
  ctx.fillStyle = '#fff3cf'
  ctx.font = `700 24px ${FONT}`
  ctx.textBaseline = 'middle'
  ctx.fillText('Storm Chasers · r3OS', x + 56, y + 29)

  // name + address
  const left = x + 44
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = TEXT
  fit(ctx, data.name, w - 88, 44)
  ctx.fillText(data.name, left, y + 128)
  ctx.fillStyle = MUTED
  ctx.font = `400 22px ${FONT}`
  ctx.fillText(`${data.address.slice(0, 6)}…${data.address.slice(-4)}`, left, y + 162)

  // headline
  ctx.fillStyle = YELLOW
  ctx.font = `700 76px ${FONT}`
  ctx.fillText(cardHeadline(data), left, y + 262)
  ctx.fillStyle = TEXT
  fit(ctx, cardSubline(data), w - 88, 26, 500)
  ctx.fillText(cardSubline(data), left, y + 306)

  // the season's storms
  const squares = cardSquares(data)
  const gap = 8
  const size = Math.floor((w - 88 - gap * (squares.length - 1)) / squares.length)
  const sy = y + 346
  squares.forEach((state, i) => {
    const sx = left + i * (size + gap)
    ctx.fillStyle = state === 'caught' ? YELLOW : state === 'missed' ? '#2b4e4b' : '#2b2b30'
    ctx.fillRect(sx, sy, size, size)
    ctx.strokeStyle = state === 'caught' ? YELLOW : state === 'missed' ? CYAN : LINE
    ctx.lineWidth = 2
    ctx.strokeRect(sx + 1, sy + 1, size - 2, size - 2)
    if (state === 'caught') bolt(ctx, sx + (size - 24) / 2, sy + (size - 32) / 2, 4, '#0b0b0c')
  })
  ctx.fillStyle = MUTED
  ctx.font = `400 20px ${FONT}`
  ctx.fillText(
    `${data.totalStorms - data.counted} of ${data.totalStorms} storms still to come`,
    left,
    sy + size + 38,
  )

  // footer rule
  ctx.fillStyle = TEXT
  ctx.font = `700 24px ${FONT}`
  const rule = 'paint 1 pixel during a DF1 storm = 1 raffle ticket'
  ctx.fillText(rule, left, y + h - 34)
  ctx.fillStyle = CYAN
  const site = 'r3os.app'
  ctx.fillText(site, x + w - 44 - ctx.measureText(site).width, y + h - 34)
}

/** Render the card to a PNG blob. */
export async function cardPng(data: CardData) {
  if (typeof document !== 'undefined' && document.fonts?.load) {
    await Promise.all([
      document.fonts.load(`700 24px ${FONT}`),
      document.fonts.load(`400 24px ${FONT}`),
    ]).catch(() => undefined)
  }
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas')
  drawCard(ctx, data)
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no image'))), 'image/png'),
  )
}

/**
 * Use the system share sheet only on touch-first devices (phones, tablets). On a desktop, macOS's
 * share sheet has no "Save" and lists X only if its app is installed, so the card was stuck in
 * AirDrop / Notes / Messages. Desktops download the PNG instead and get a "post on X" link.
 */
export function prefersShareSheet(env: { touchFirst: boolean; canShareFiles: boolean }) {
  return env.touchFirst && env.canShareFiles
}

function touchFirst() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(pointer: coarse)').matches && window.matchMedia('(hover: none)').matches
}

/** Download the card's PNG. */
export function downloadCard(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'r3os-storm-card.png'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** Share through the phone's share sheet, else (desktops, or no file sharing) download the PNG. */
export async function shareCard(data: CardData, options: { download?: boolean } = {}) {
  const blob = await cardPng(data)
  const file = new File([blob], 'r3os-storm-card.png', { type: 'image/png' })
  const text = `${cardHeadline(data)} in r3OS Storm Season ⚡ paint 1 pixel during a DF1 storm = 1 raffle ticket`
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  const canShareFiles = typeof nav.share === 'function' && nav.canShare?.({ files: [file] }) === true
  if (!options.download && prefersShareSheet({ touchFirst: touchFirst(), canShareFiles })) {
    try {
      await nav.share({ files: [file], text })
      return 'shared'
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') return 'cancelled'
    }
  }
  downloadCard(blob)
  return 'downloaded'
}
