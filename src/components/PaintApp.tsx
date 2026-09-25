import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  decodeEventLog,
  type Address,
  type Hex,
} from 'viem'
import { r3tardsPaintAbi } from '../lib/abi'
import {
  chain,
  contractAddress,
  ensureMonadChain,
  explorerUrl,
  publicClient,
  walletClient,
} from '../lib/chain'
import { createGenesisCanvas } from '../lib/genesis'
import { INITIAL_FACE_COLOR, compositeCanvas, compositeColor } from '../lib/layers'
import {
  drawBrush,
  drawEllipse,
  drawLine,
  drawPolygon,
  drawQuadraticCurve,
  drawRect,
  drawRoundedRect,
  drawText,
  floodFill,
  pointInPolygon,
  setPixel,
  spray,
  type Point,
} from '../lib/paintEngine'
import { HEIGHT, PALETTE, WIDTH } from '../lib/palette'
import { decodePackedCanvas, encodeChangedRuns } from '../lib/patch'

type Tool =
  | 'freeSelect'
  | 'rectSelect'
  | 'eraser'
  | 'fill'
  | 'picker'
  | 'zoom'
  | 'pencil'
  | 'brush'
  | 'spray'
  | 'text'
  | 'line'
  | 'curve'
  | 'rect'
  | 'polygon'
  | 'ellipse'
  | 'roundRect'

type Selection = {
  x: number
  y: number
  w: number
  h: number
  mask: Uint8Array
  pixels: Uint8Array
}

type MintResult = {
  tokenId: bigint
  df1: number
  txHash: Hex
  pixelWrites: bigint
  finalFaceColor: number
}

type Snapshot = {
  buffer: Uint8Array
  faceColor: number
}

const TOOL_DEFS: { id: Tool; glyph: string; label: string }[] = [
  { id: 'freeSelect', glyph: '☆', label: 'Free-form Select' },
  { id: 'rectSelect', glyph: '▭', label: 'Select' },
  { id: 'eraser', glyph: '▱', label: 'Eraser' },
  { id: 'fill', glyph: '◒', label: 'Fill With Color' },
  { id: 'picker', glyph: '⌁', label: 'Pick Color' },
  { id: 'zoom', glyph: '⌕', label: 'Magnifier' },
  { id: 'pencil', glyph: '╱', label: 'Pencil' },
  { id: 'brush', glyph: '♟', label: 'Brush' },
  { id: 'spray', glyph: '⁙', label: 'Airbrush' },
  { id: 'text', glyph: 'A', label: 'Text' },
  { id: 'line', glyph: '╲', label: 'Line' },
  { id: 'curve', glyph: '∿', label: 'Curve' },
  { id: 'rect', glyph: '□', label: 'Rectangle' },
  { id: 'polygon', glyph: '⌑', label: 'Polygon' },
  { id: 'ellipse', glyph: '○', label: 'Ellipse' },
  { id: 'roundRect', glyph: '▢', label: 'Rounded Rectangle' },
]

const INITIAL = createGenesisCanvas()

const clone = (value: Uint8Array) => new Uint8Array(value)
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function selectionContains(selection: Selection, point: Point) {
  const lx = point.x - selection.x
  const ly = point.y - selection.y
  if (lx < 0 || ly < 0 || lx >= selection.w || ly >= selection.h) return false
  return selection.mask[ly * selection.w + lx] === 1
}

function makeRectSelection(buffer: Uint8Array, a: Point, b: Point): Selection {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const w = x1 - x + 1
  const h = y1 - y + 1
  const mask = new Uint8Array(w * h).fill(1)
  const pixels = new Uint8Array(w * h)
  for (let yy = 0; yy < h; yy += 1) {
    for (let xx = 0; xx < w; xx += 1) {
      pixels[yy * w + xx] = buffer[(y + yy) * WIDTH + (x + xx)]
    }
  }
  return { x, y, w, h, mask, pixels }
}

function makeLassoSelection(buffer: Uint8Array, points: Point[]): Selection | null {
  if (points.length < 3) return null
  const minX = clamp(Math.min(...points.map((p) => p.x)), 0, WIDTH - 1)
  const maxX = clamp(Math.max(...points.map((p) => p.x)), 0, WIDTH - 1)
  const minY = clamp(Math.min(...points.map((p) => p.y)), 0, HEIGHT - 1)
  const maxY = clamp(Math.max(...points.map((p) => p.y)), 0, HEIGHT - 1)
  const w = maxX - minX + 1
  const h = maxY - minY + 1
  const mask = new Uint8Array(w * h)
  const pixels = new Uint8Array(w * h)

  for (let yy = 0; yy < h; yy += 1) {
    for (let xx = 0; xx < w; xx += 1) {
      const world = { x: minX + xx + 0.5, y: minY + yy + 0.5 }
      if (!pointInPolygon(world, points)) continue
      const i = yy * w + xx
      mask[i] = 1
      pixels[i] = buffer[(minY + yy) * WIDTH + minX + xx]
    }
  }

  return { x: minX, y: minY, w, h, mask, pixels }
}

function moveSelection(
  source: Uint8Array,
  selection: Selection,
  nextX: number,
  nextY: number,
  background: number,
) {
  const out = clone(source)
  for (let yy = 0; yy < selection.h; yy += 1) {
    for (let xx = 0; xx < selection.w; xx += 1) {
      const si = yy * selection.w + xx
      if (!selection.mask[si]) continue
      setPixel(out, selection.x + xx, selection.y + yy, background)
    }
  }
  for (let yy = 0; yy < selection.h; yy += 1) {
    for (let xx = 0; xx < selection.w; xx += 1) {
      const si = yy * selection.w + xx
      if (!selection.mask[si]) continue
      setPixel(out, nextX + xx, nextY + yy, selection.pixels[si])
    }
  }
  return out
}

export function PaintApp() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [baseline, setBaseline] = useState<Uint8Array>(() => clone(INITIAL))
  const [working, setWorking] = useState<Uint8Array>(() => clone(INITIAL))
  const [baselineFaceColor, setBaselineFaceColor] = useState(INITIAL_FACE_COLOR)
  const [workingFaceColor, setWorkingFaceColor] = useState(INITIAL_FACE_COLOR)
  const [tool, setTool] = useState<Tool>('pencil')
  const [fg, setFg] = useState(1)
  const [bg, setBg] = useState(0)
  const [zoom, setZoom] = useState(2)
  const [brushSize, setBrushSize] = useState(3)
  const [filledShapes, setFilledShapes] = useState(false)
  const [pointer, setPointer] = useState<Point>({ x: 0, y: 0 })
  const [status, setStatus] = useState('For Help, click Help Topics on the Help Menu.')
  const [wallet, setWallet] = useState<Address | null>(null)
  const [chainMints, setChainMints] = useState(0n)
  const [df1Estimate, setDf1Estimate] = useState(0)
  const [baseFee, setBaseFee] = useState<bigint | null>(null)
  const [busy, setBusy] = useState(false)
  const [mintResult, setMintResult] = useState<MintResult | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [selectionDraft, setSelectionDraft] = useState<Point[]>([])
  const [undoStack, setUndoStack] = useState<Snapshot[]>([])
  const [redoStack, setRedoStack] = useState<Snapshot[]>([])
  const [polygon, setPolygon] = useState<{ base: Uint8Array; points: Point[] } | null>(null)
  const [curve, setCurve] = useState<{ base: Uint8Array; start: Point; end: Point } | null>(null)

  const gesture = useRef<{
    active: boolean
    start: Point
    last: Point
    color: number
    base: Uint8Array
    movedSelection?: boolean
    selectionOffset?: Point
  } | null>(null)

  const pending = useMemo(() => encodeChangedRuns(baseline, working), [baseline, working])
  const display = useMemo(() => compositeCanvas(working, workingFaceColor), [working, workingFaceColor])
  const facePending = workingFaceColor !== baselineFaceColor

  const pushUndo = useCallback((snapshot: Uint8Array, snapshotFaceColor = workingFaceColor) => {
    setUndoStack((stack) => [...stack.slice(-29), { buffer: clone(snapshot), faceColor: snapshotFaceColor }])
    setRedoStack([])
  }, [workingFaceColor])

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (!stack.length) return stack
      const previous = stack[stack.length - 1]
      setRedoStack((redo) => [...redo.slice(-29), { buffer: clone(working), faceColor: workingFaceColor }])
      setWorking(clone(previous.buffer))
      setWorkingFaceColor(previous.faceColor)
      setSelection(null)
      return stack.slice(0, -1)
    })
  }, [working, workingFaceColor])

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (!stack.length) return stack
      const next = stack[stack.length - 1]
      setUndoStack((undoItems) => [...undoItems.slice(-29), { buffer: clone(working), faceColor: workingFaceColor }])
      setWorking(clone(next.buffer))
      setWorkingFaceColor(next.faceColor)
      setSelection(null)
      return stack.slice(0, -1)
    })
  }, [working, workingFaceColor])

  const reloadChain = useCallback(async (replaceWorking = true) => {
    if (!publicClient || !contractAddress) {
      setStatus('demo mode - add VITE_RPC_URL + VITE_CONTRACT_ADDRESS to go onchain')
      return
    }

    try {
      const [rawCanvas, total, block, faceColor] = await Promise.all([
        publicClient.readContract({
          address: contractAddress,
          abi: r3tardsPaintAbi,
          functionName: 'getBackgroundCanvas',
        }),
        publicClient.readContract({
          address: contractAddress,
          abi: r3tardsPaintAbi,
          functionName: 'totalMints',
        }),
        publicClient.getBlock({ blockTag: 'latest' }),
        publicClient.readContract({
          address: contractAddress,
          abi: r3tardsPaintAbi,
          functionName: 'faceColorIndex',
        }),
      ])
      const next = decodePackedCanvas(rawCanvas as Hex)
      const nextFaceColor = Number(faceColor)
      setBaseline(next)
      setBaselineFaceColor(nextFaceColor)
      if (replaceWorking) {
        setWorking(clone(next))
        setWorkingFaceColor(nextFaceColor)
        setUndoStack([])
        setRedoStack([])
        setSelection(null)
      }
      setChainMints(total)
      const fee = block.baseFeePerGas ?? 0n
      setBaseFee(fee)
      const level = await publicClient.readContract({
        address: contractAddress,
        abi: r3tardsPaintAbi,
        functionName: 'df1LevelForBaseFee',
        args: [fee],
      })
      setDf1Estimate(Number(level))
      setStatus(`loaded mint #${total.toString()} from ${chain.name}`)
    } catch (error) {
      setStatus(`chain read failed: ${(error as Error).message}`)
    }
  }, [])

  const refreshNetworkWeather = useCallback(async () => {
    if (!publicClient || !contractAddress) return
    try {
      const [block, total] = await Promise.all([
        publicClient.getBlock({ blockTag: 'latest' }),
        publicClient.readContract({
          address: contractAddress,
          abi: r3tardsPaintAbi,
          functionName: 'totalMints',
        }),
      ])
      const fee = block.baseFeePerGas ?? 0n
      setBaseFee(fee)
      setChainMints(total)
      const level = await publicClient.readContract({
        address: contractAddress,
        abi: r3tardsPaintAbi,
        functionName: 'df1LevelForBaseFee',
        args: [fee],
      })
      setDf1Estimate(Number(level))
    } catch {
      // Public RPC hiccups do not destroy local edits. Humanity has suffered enough.
    }
  }, [])

  useEffect(() => {
    reloadChain(true)
    const timer = window.setInterval(refreshNetworkWeather, 4_000)
    return () => window.clearInterval(timer)
  }, [reloadChain, refreshNetworkWeather])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
      }
      if (event.key === 'Escape') {
        setSelection(null)
        setPolygon(null)
        setCurve(null)
        setSelectionDraft([])
      }
      if (event.key === 'Enter' && polygon && polygon.points.length > 2) {
        const next = clone(polygon.base)
        drawPolygon(next, polygon.points, fg, true, brushSize)
        pushUndo(polygon.base)
        setWorking(next)
        setPolygon(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [brushSize, fg, polygon, pushUndo, redo, undo])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const image = ctx.createImageData(WIDTH, HEIGHT)

    for (let i = 0; i < display.length; i += 1) {
      const entry = PALETTE[display[i]] ?? PALETTE[0]
      const o = i * 4
      image.data[o] = entry.rgb[0]
      image.data[o + 1] = entry.rgb[1]
      image.data[o + 2] = entry.rgb[2]
      image.data[o + 3] = 255
    }
    ctx.putImageData(image, 0, 0)

    ctx.save()
    ctx.lineWidth = 1
    ctx.setLineDash([2, 2])
    ctx.strokeStyle = '#000'

    if (selection) {
      ctx.strokeRect(selection.x + 0.5, selection.y + 0.5, selection.w, selection.h)
    }
    if (selectionDraft.length > 1) {
      ctx.beginPath()
      ctx.moveTo(selectionDraft[0].x, selectionDraft[0].y)
      for (let i = 1; i < selectionDraft.length; i += 1) {
        ctx.lineTo(selectionDraft[i].x, selectionDraft[i].y)
      }
      ctx.stroke()
    }
    if (polygon?.points.length) {
      ctx.beginPath()
      ctx.moveTo(polygon.points[0].x, polygon.points[0].y)
      for (let i = 1; i < polygon.points.length; i += 1) {
        ctx.lineTo(polygon.points[i].x, polygon.points[i].y)
      }
      ctx.stroke()
    }
    ctx.restore()
  }, [display, polygon, selection, selectionDraft])

  const canvasPoint = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: clamp(Math.floor(((event.clientX - rect.left) / rect.width) * WIDTH), 0, WIDTH - 1),
      y: clamp(Math.floor(((event.clientY - rect.top) / rect.height) * HEIGHT), 0, HEIGHT - 1),
    }
  }

  const colorFromButton = (button: number) => button === 2 ? bg : fg

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = canvasPoint(event)
    setPointer(point)
    const color = colorFromButton(event.button)

    if (tool === 'picker') {
      const picked = compositeColor(working[point.y * WIDTH + point.x], point.x, point.y, workingFaceColor)
      if (event.button === 2) setBg(picked)
      else setFg(picked)
      setStatus(`picked ${PALETTE[picked].name}`)
      return
    }

    if (tool === 'zoom') {
      setZoom((z) => z >= 4 ? 1 : z + 1)
      return
    }

    if (tool === 'fill') {
      const before = clone(working)
      const next = clone(working)
      const changed = floodFill(next, point, color)
      if (changed) {
        pushUndo(before)
        setWorking(next)
      }
      setStatus(`fill: ${changed.toLocaleString()} intended pixels`)
      return
    }

    if (tool === 'text') {
      const value = window.prompt('Text:', 'r3tard')
      if (!value) return
      const before = clone(working)
      const next = clone(working)
      drawText(next, point, value, color, brushSize >= 5 ? 2 : 1)
      pushUndo(before)
      setWorking(next)
      return
    }

    if (tool === 'polygon') {
      if (!polygon) {
        setPolygon({ base: clone(working), points: [point] })
        setStatus('polygon: click more points, double-click or Enter to close')
      } else {
        const points = [...polygon.points, point]
        const next = clone(polygon.base)
        drawPolygon(next, points, color, false, brushSize)
        setPolygon({ ...polygon, points })
        setWorking(next)
      }
      return
    }

    if (tool === 'curve' && curve) {
      const next = clone(curve.base)
      drawQuadraticCurve(next, curve.start, point, curve.end, color, brushSize)
      pushUndo(curve.base)
      setWorking(next)
      setCurve(null)
      setStatus('curve committed')
      return
    }

    if ((tool === 'rectSelect' || tool === 'freeSelect') && selection && selectionContains(selection, point)) {
      gesture.current = {
        active: true,
        start: point,
        last: point,
        color,
        base: clone(working),
        movedSelection: true,
        selectionOffset: { x: point.x - selection.x, y: point.y - selection.y },
      }
      return
    }

    if (tool === 'rectSelect' || tool === 'freeSelect') {
      setSelection(null)
      setSelectionDraft([point])
      gesture.current = { active: true, start: point, last: point, color, base: clone(working) }
      return
    }

    const before = clone(working)
    gesture.current = { active: true, start: point, last: point, color, base: before }

    if (tool === 'pencil') {
      const next = clone(working)
      setPixel(next, point.x, point.y, color)
      setWorking(next)
    } else if (tool === 'brush') {
      const next = clone(working)
      drawBrush(next, point.x, point.y, color, brushSize)
      setWorking(next)
    } else if (tool === 'eraser') {
      const next = clone(working)
      drawBrush(next, point.x, point.y, 0, Math.max(5, brushSize + 4))
      setWorking(next)
    } else if (tool === 'spray') {
      const next = clone(working)
      spray(next, point, color, Math.max(5, brushSize + 4), 24)
      setWorking(next)
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = canvasPoint(event)
    setPointer(point)
    const g = gesture.current
    if (!g?.active) return

    if ((tool === 'rectSelect' || tool === 'freeSelect') && g.movedSelection && selection && g.selectionOffset) {
      const nx = clamp(point.x - g.selectionOffset.x, -selection.w + 1, WIDTH - 1)
      const ny = clamp(point.y - g.selectionOffset.y, -selection.h + 1, HEIGHT - 1)
      setWorking(moveSelection(g.base, selection, nx, ny, bg))
      return
    }

    if (tool === 'rectSelect') {
      setSelectionDraft([g.start, point])
      return
    }
    if (tool === 'freeSelect') {
      setSelectionDraft((path) => [...path, point])
      return
    }

    if (tool === 'pencil') {
      const next = clone(working)
      drawLine(next, g.last, point, g.color, 1)
      g.last = point
      setWorking(next)
      return
    }
    if (tool === 'brush') {
      const next = clone(working)
      drawLine(next, g.last, point, g.color, brushSize)
      g.last = point
      setWorking(next)
      return
    }
    if (tool === 'eraser') {
      const next = clone(working)
      drawLine(next, g.last, point, 0, Math.max(5, brushSize + 4))
      g.last = point
      setWorking(next)
      return
    }
    if (tool === 'spray') {
      const next = clone(working)
      spray(next, point, g.color, Math.max(5, brushSize + 4), 16)
      g.last = point
      setWorking(next)
      return
    }

    const next = clone(g.base)
    if (tool === 'line' || (tool === 'curve' && !curve)) {
      drawLine(next, g.start, point, g.color, brushSize)
    } else if (tool === 'rect') {
      drawRect(next, g.start, point, g.color, filledShapes, brushSize)
    } else if (tool === 'ellipse') {
      drawEllipse(next, g.start, point, g.color, filledShapes, brushSize)
    } else if (tool === 'roundRect') {
      drawRoundedRect(next, g.start, point, g.color, filledShapes, brushSize)
    }
    setWorking(next)
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = canvasPoint(event)
    const g = gesture.current
    if (!g?.active) return
    g.active = false

    if ((tool === 'rectSelect' || tool === 'freeSelect') && g.movedSelection && selection && g.selectionOffset) {
      pushUndo(g.base)
      setSelection({
        ...selection,
        x: clamp(point.x - g.selectionOffset.x, -selection.w + 1, WIDTH - 1),
        y: clamp(point.y - g.selectionOffset.y, -selection.h + 1, HEIGHT - 1),
      })
      gesture.current = null
      return
    }

    if (tool === 'rectSelect') {
      const nextSelection = makeRectSelection(working, g.start, point)
      setSelection(nextSelection)
      setSelectionDraft([])
      gesture.current = null
      return
    }

    if (tool === 'freeSelect') {
      const nextSelection = makeLassoSelection(working, selectionDraft)
      setSelection(nextSelection)
      setSelectionDraft([])
      gesture.current = null
      return
    }

    if (tool === 'curve' && !curve) {
      setCurve({ base: g.base, start: g.start, end: point })
      const next = clone(g.base)
      drawLine(next, g.start, point, g.color, brushSize)
      setWorking(next)
      setStatus('curve: click once to place the bend')
      gesture.current = null
      return
    }

    if (!working.every((value, index) => value === g.base[index])) {
      pushUndo(g.base)
    }
    gesture.current = null
  }

  const onDoubleClick = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (tool !== 'polygon' || !polygon || polygon.points.length < 2) return
    const point = canvasPoint(event)
    const points = [...polygon.points, point]
    const next = clone(polygon.base)
    drawPolygon(next, points, fg, true, brushSize)
    pushUndo(polygon.base)
    setWorking(next)
    setPolygon(null)
    setStatus('polygon committed')
  }

  const connect = async () => {
    try {
      const wc = walletClient()
      if (!wc) throw new Error('No injected wallet found. Install MetaMask or another injected wallet.')
      await ensureMonadChain()
      const addresses = await wc.requestAddresses()
      if (!addresses.length) throw new Error('Wallet returned no account.')
      setWallet(addresses[0])
      setStatus(`connected ${shortAddress(addresses[0])}`)
    } catch (error) {
      setStatus((error as Error).message)
    }
  }

  const mint = async () => {
    if (!pending.pixelWrites && !facePending) {
      setStatus('nothing changed. even the blockchain deserves a reason.')
      return
    }
    if (!contractAddress || !publicClient) {
      setStatus('demo mode: configure RPC + contract address before minting')
      return
    }
    if (pending.pixelWrites > 65_536) {
      setStatus('patch exceeds contract pixel-write limit')
      return
    }

    setBusy(true)
    setMenu(null)
    try {
      const wc = walletClient()
      if (!wc) throw new Error('No injected wallet found.')
      await ensureMonadChain()
      const accounts = await wc.requestAddresses()
      const account = accounts[0]
      setWallet(account)

      const estimate = await publicClient.estimateContractGas({
        address: contractAddress,
        abi: r3tardsPaintAbi,
        functionName: 'paintAndMint',
        args: [pending.hex, workingFaceColor],
        account,
      })

      // Monad charges from the declared gas limit, so keep the buffer tight.
      // 2% + 10k avoids the traditional giant-limit ritual without hugging the estimate to death.
      const gas = estimate + estimate / 50n + 10_000n
      setStatus(`signing mint - estimated ${estimate.toLocaleString()} gas, limit ${gas.toLocaleString()}`)

      const hash = await wc.writeContract({
        address: contractAddress,
        abi: r3tardsPaintAbi,
        functionName: 'paintAndMint',
        args: [pending.hex, workingFaceColor],
        account,
        chain,
        gas,
      })

      setStatus(`waiting for ${hash.slice(0, 10)}…`)
      const receipt = await publicClient.waitForTransactionReceipt({ hash })

      let result: MintResult | null = null
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: r3tardsPaintAbi,
            data: log.data,
            topics: log.topics,
          })
          if (decoded.eventName === 'Painted') {
            result = {
              tokenId: decoded.args.tokenId,
              df1: Number(decoded.args.df1Level),
              txHash: hash,
              pixelWrites: decoded.args.pixelWrites,
              finalFaceColor: Number(decoded.args.finalFaceColor),
            }
            break
          }
        } catch {
          // Not our event.
        }
      }

      await reloadChain(true)
      setMintResult(result ?? { tokenId: chainMints + 1n, df1: df1Estimate, txHash: hash, pixelWrites: BigInt(pending.pixelWrites), finalFaceColor: workingFaceColor })
      setStatus('your image was saved. unfortunately everyone else can still edit it.')
    } catch (error) {
      setStatus(`mint failed: ${(error as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const resetPending = () => {
    if (!pending.pixelWrites && !facePending) return
    pushUndo(working, workingFaceColor)
    setWorking(clone(baseline))
    setWorkingFaceColor(baselineFaceColor)
    setSelection(null)
    setPolygon(null)
    setCurve(null)
  }

  const flipHorizontal = () => {
    const before = clone(working)
    const next = clone(working)
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        next[y * WIDTH + x] = working[y * WIDTH + (WIDTH - 1 - x)]
      }
    }
    pushUndo(before)
    setWorking(next)
  }

  const flipVertical = () => {
    const before = clone(working)
    const next = clone(working)
    for (let y = 0; y < HEIGHT; y += 1) {
      next.set(working.slice((HEIGHT - 1 - y) * WIDTH, (HEIGHT - y) * WIDTH), y * WIDTH)
    }
    pushUndo(before)
    setWorking(next)
  }

  const clearImage = () => {
    const before = clone(working)
    const next = new Uint8Array(WIDTH * HEIGHT).fill(bg)
    pushUndo(before)
    setWorking(next)
  }

  const menuItems: Record<string, { label: string; action: () => void; disabled?: boolean }[]> = {
    File: [
      { label: 'Mint / Save', action: mint, disabled: busy },
      { label: 'Reload from chain', action: () => reloadChain(true) },
      { label: 'Revert pending edits', action: resetPending },
    ],
    Edit: [
      { label: 'Undo   Ctrl+Z', action: undo, disabled: !undoStack.length },
      { label: 'Redo   Ctrl+Y', action: redo, disabled: !redoStack.length },
      { label: 'Clear selection', action: () => setSelection(null) },
    ],
    View: [
      { label: 'Zoom 1x', action: () => setZoom(1) },
      { label: 'Zoom 2x', action: () => setZoom(2) },
      { label: 'Zoom 3x', action: () => setZoom(3) },
      { label: 'Zoom 4x', action: () => setZoom(4) },
    ],
    Image: [
      { label: 'Flip horizontal', action: flipHorizontal },
      { label: 'Flip vertical', action: flipVertical },
      { label: 'Clear image', action: clearImage },
    ],
    Colors: [
      { label: 'Swap foreground/background', action: () => { const old = fg; setFg(bg); setBg(old) } },
      { label: workingFaceColor === 1 ? 'Set face white' : 'Set face black', action: () => { pushUndo(working, workingFaceColor); setWorkingFaceColor(workingFaceColor === 1 ? 0 : 1) } },
    ],
    Help: [
      { label: 'About r3tards paint', action: () => window.alert('one r3tard. one paint file. anyone can edit it. mint to save. it never ends.\n\nr3tards is not a r3al proj3ct.') },
    ],
  }

  const title = wallet
    ? `${shortAddress(wallet)} - r3tards paint`
    : 'untitled - r3tards paint'

  return (
    <div className="desktop" onPointerDown={() => menu && setMenu(null)}>
      <div className="paint-window" onPointerDown={(event) => event.stopPropagation()}>
        <div className="titlebar">
          <div className="title-left">
            <span className="app-icon">▧</span>
            <span>{title}</span>
          </div>
          <div className="window-controls" aria-hidden="true">
            <button>_</button><button>□</button><button className="close">×</button>
          </div>
        </div>

        <div className="menubar">
          {Object.keys(menuItems).map((name) => (
            <div className="menu-wrap" key={name}>
              <button
                className={menu === name ? 'menu-button open' : 'menu-button'}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  setMenu((current) => current === name ? null : name)
                }}
              >
                {name}
              </button>
              {menu === name && (
                <div className="menu-popup">
                  {menuItems[name].map((item) => (
                    <button
                      key={item.label}
                      disabled={item.disabled}
                      onClick={() => {
                        item.action()
                        setMenu(null)
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="chain-badge">{contractAddress ? chain.name : 'demo'}</div>
        </div>

        <div className="work-area">
          <aside className="tool-panel">
            <div className="tool-grid">
              {TOOL_DEFS.map((entry) => (
                <button
                  key={entry.id}
                  title={entry.label}
                  className={tool === entry.id ? 'tool active' : 'tool'}
                  onClick={() => {
                    setTool(entry.id)
                    setSelection(null)
                    setSelectionDraft([])
                    setPolygon(null)
                    setCurve(null)
                    setStatus(entry.label)
                  }}
                >
                  <span>{entry.glyph}</span>
                </button>
              ))}
            </div>

            <div className="tool-options">
              <div className="option-caption">size</div>
              <div className="size-options">
                {[1, 3, 5, 8].map((size) => (
                  <button
                    key={size}
                    className={brushSize === size ? 'size active' : 'size'}
                    onClick={() => setBrushSize(size)}
                    title={`${size}px`}
                  >
                    <span style={{ height: Math.min(8, size), width: 20 }} />
                  </button>
                ))}
              </div>
              <label className="fill-check">
                <input type="checkbox" checked={filledShapes} onChange={(e) => setFilledShapes(e.target.checked)} />
                fill
              </label>
            </div>
          </aside>

          <main className="canvas-well">
            <div className="canvas-scroll">
              <div className="canvas-stage" style={{ width: WIDTH * zoom + 12, height: HEIGHT * zoom + 12 }}>
                <canvas
                  ref={canvasRef}
                  width={WIDTH}
                  height={HEIGHT}
                  style={{ width: WIDTH * zoom, height: HEIGHT * zoom }}
                  onContextMenu={(event) => event.preventDefault()}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={() => { gesture.current = null }}
                  onDoubleClick={onDoubleClick}
                />
                <div className="resize-handle" style={{ left: WIDTH * zoom + 2, top: HEIGHT * zoom + 2 }} />
              </div>
            </div>
          </main>
        </div>

        <div className="palette-bar">
          <div className="color-wells" title="foreground / background">
            <div className="bg-well" style={{ background: PALETTE[bg].hex }} />
            <div className="fg-well" style={{ background: PALETTE[fg].hex }} />
          </div>
          <div className="swatches">
            {PALETTE.map((entry) => (
              <button
                key={entry.index}
                title={`${entry.index} - ${entry.name} ${entry.hex}`}
                style={{ background: entry.hex }}
                className={fg === entry.index ? 'swatch foreground' : bg === entry.index ? 'swatch background' : 'swatch'}
                onClick={() => setFg(entry.index)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  setBg(entry.index)
                }}
              />
            ))}
          </div>
          <div className="face-controls" title="r3tard face state">
            <span className="face-label">FACE</span>
            <button
              className={workingFaceColor === 0 ? 'classic-button active-face' : 'classic-button'}
              onClick={() => {
                if (workingFaceColor === 0) return
                pushUndo(working, workingFaceColor)
                setWorkingFaceColor(0)
              }}
            >
              WHITE
            </button>
            <button
              className={workingFaceColor === 1 ? 'classic-button active-face' : 'classic-button'}
              onClick={() => {
                if (workingFaceColor === 1) return
                pushUndo(working, workingFaceColor)
                setWorkingFaceColor(1)
              }}
            >
              BLACK
            </button>
          </div>
          <div className="mint-controls">
            <div className="mint-stats">
              <span>mint #{(chainMints + 1n).toString()}</span>
              <span>{pending.pixelWrites.toLocaleString()} px pending{facePending ? ' + face flip' : ''}</span>
            </div>
            <button className="classic-button" onClick={wallet ? mint : connect} disabled={busy}>
              {busy ? 'SAVING...' : wallet ? 'MINT / SAVE' : 'CONNECT'}
            </button>
          </div>
        </div>

        <div className="statusbar">
          <div className="status-message">{status}</div>
          <div className="status-cell">{pointer.x}, {pointer.y}px</div>
          <div className="status-cell df1" title={baseFee ? `latest base fee: ${baseFee.toString()} wei` : 'demo estimate'}>
            DF1 est. {df1Estimate}%
          </div>
        </div>
      </div>

      {mintResult && (
        <div className="modal-backdrop" onClick={() => setMintResult(null)}>
          <div className="classic-dialog" onClick={(event) => event.stopPropagation()}>
            <div className="dialog-title">r3tards paint</div>
            <div className="dialog-body">
              <div className="dialog-icon">▧</div>
              <div>
                <p>your image was saved.</p>
                <p><strong>DF1 DAMAGE: {mintResult.df1}%</strong></p>
                <p>mint #{mintResult.tokenId.toString()} · {mintResult.pixelWrites.toString()} pixel writes</p>
                <p>face saved as <strong>{mintResult.finalFaceColor === 1 ? 'BLACK' : 'WHITE'}</strong></p>
                {explorerUrl && (
                  <a href={`${explorerUrl.replace(/\/$/, '')}/tx/${mintResult.txHash}`} target="_blank" rel="noreferrer">
                    view transaction
                  </a>
                )}
              </div>
            </div>
            <button className="classic-button dialog-ok" onClick={() => setMintResult(null)}>OK</button>
          </div>
        </div>
      )}
    </div>
  )
}
