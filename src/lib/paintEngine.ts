import { HEIGHT, WIDTH } from './palette'

export type Point = { x: number; y: number }

export const pixelIndex = (x: number, y: number) => y * WIDTH + x

export function inBounds(x: number, y: number) {
  return x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT
}

export function setPixel(buffer: Uint8Array, x: number, y: number, color: number) {
  if (!inBounds(x, y)) return
  buffer[pixelIndex(x, y)] = color
}

export function drawBrush(buffer: Uint8Array, x: number, y: number, color: number, size: number) {
  const radius = Math.max(0, Math.floor((size - 1) / 2))
  for (let yy = y - radius; yy <= y + radius; yy += 1) {
    for (let xx = x - radius; xx <= x + radius; xx += 1) {
      setPixel(buffer, xx, yy, color)
    }
  }
}

export function drawLine(buffer: Uint8Array, start: Point, end: Point, color: number, size = 1) {
  let x0 = start.x
  let y0 = start.y
  const x1 = end.x
  const y1 = end.y
  const dx = Math.abs(x1 - x0)
  const sx = x0 < x1 ? 1 : -1
  const dy = -Math.abs(y1 - y0)
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy

  while (true) {
    drawBrush(buffer, x0, y0, color, size)
    if (x0 === x1 && y0 === y1) break
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x0 += sx
    }
    if (e2 <= dx) {
      err += dx
      y0 += sy
    }
  }
}

export function drawRect(buffer: Uint8Array, a: Point, b: Point, color: number, filled = false, size = 1) {
  const x0 = Math.min(a.x, b.x)
  const x1 = Math.max(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const y1 = Math.max(a.y, b.y)

  if (filled) {
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) setPixel(buffer, x, y, color)
    }
    return
  }

  drawLine(buffer, { x: x0, y: y0 }, { x: x1, y: y0 }, color, size)
  drawLine(buffer, { x: x1, y: y0 }, { x: x1, y: y1 }, color, size)
  drawLine(buffer, { x: x1, y: y1 }, { x: x0, y: y1 }, color, size)
  drawLine(buffer, { x: x0, y: y1 }, { x: x0, y: y0 }, color, size)
}

export function drawEllipse(buffer: Uint8Array, a: Point, b: Point, color: number, filled = false, size = 1) {
  const x0 = Math.min(a.x, b.x)
  const x1 = Math.max(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const y1 = Math.max(a.y, b.y)
  const rx = Math.max(0.5, (x1 - x0) / 2)
  const ry = Math.max(0.5, (y1 - y0) / 2)
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const edge = Math.max(0.03, Math.min(0.5, size / Math.max(rx, ry)))

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const nx = (x - cx) / rx
      const ny = (y - cy) / ry
      const d = nx * nx + ny * ny
      if (filled ? d <= 1 : d <= 1 + edge && d >= 1 - edge) {
        setPixel(buffer, x, y, color)
      }
    }
  }
}

export function drawRoundedRect(
  buffer: Uint8Array,
  a: Point,
  b: Point,
  color: number,
  filled = false,
  size = 1,
) {
  const x0 = Math.min(a.x, b.x)
  const x1 = Math.max(a.x, b.x)
  const y0 = Math.min(a.y, b.y)
  const y1 = Math.max(a.y, b.y)
  const radius = Math.max(2, Math.min(10, Math.floor(Math.min(x1 - x0, y1 - y0) / 4)))

  if (filled) {
    drawRect(buffer, { x: x0 + radius, y: y0 }, { x: x1 - radius, y: y1 }, color, true)
    drawRect(buffer, { x: x0, y: y0 + radius }, { x: x1, y: y1 - radius }, color, true)
  } else {
    drawLine(buffer, { x: x0 + radius, y: y0 }, { x: x1 - radius, y: y0 }, color, size)
    drawLine(buffer, { x: x0 + radius, y: y1 }, { x: x1 - radius, y: y1 }, color, size)
    drawLine(buffer, { x: x0, y: y0 + radius }, { x: x0, y: y1 - radius }, color, size)
    drawLine(buffer, { x: x1, y: y0 + radius }, { x: x1, y: y1 - radius }, color, size)
  }

  // Quarter arcs, evaluated pixel by pixel.
  const corners = [
    { cx: x0 + radius, cy: y0 + radius, qx: -1, qy: -1 },
    { cx: x1 - radius, cy: y0 + radius, qx: 1, qy: -1 },
    { cx: x0 + radius, cy: y1 - radius, qx: -1, qy: 1 },
    { cx: x1 - radius, cy: y1 - radius, qx: 1, qy: 1 },
  ]

  for (const corner of corners) {
    for (let dy = 0; dy <= radius; dy += 1) {
      for (let dx = 0; dx <= radius; dx += 1) {
        const d = dx * dx + dy * dy
        const r2 = radius * radius
        const edge = Math.max(1, radius * size)
        if (filled ? d <= r2 : Math.abs(d - r2) <= edge) {
          setPixel(buffer, corner.cx + corner.qx * dx, corner.cy + corner.qy * dy, color)
        }
      }
    }
  }
}

export function drawQuadraticCurve(
  buffer: Uint8Array,
  start: Point,
  control: Point,
  end: Point,
  color: number,
  size = 1,
) {
  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  const steps = Math.max(12, Math.min(256, Math.ceil(distance * 2)))
  let previous = start

  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    const u = 1 - t
    const next = {
      x: Math.round(u * u * start.x + 2 * u * t * control.x + t * t * end.x),
      y: Math.round(u * u * start.y + 2 * u * t * control.y + t * t * end.y),
    }
    drawLine(buffer, previous, next, color, size)
    previous = next
  }
}

export function drawPolygon(buffer: Uint8Array, points: Point[], color: number, close = true, size = 1) {
  if (points.length < 2) return
  for (let i = 1; i < points.length; i += 1) {
    drawLine(buffer, points[i - 1], points[i], color, size)
  }
  if (close && points.length > 2) drawLine(buffer, points[points.length - 1], points[0], color, size)
}

export function floodFill(buffer: Uint8Array, start: Point, color: number) {
  if (!inBounds(start.x, start.y)) return 0
  const target = buffer[pixelIndex(start.x, start.y)]
  if (target === color) return 0

  const queue = new Int32Array(WIDTH * HEIGHT)
  let head = 0
  let tail = 0
  queue[tail++] = pixelIndex(start.x, start.y)
  buffer[pixelIndex(start.x, start.y)] = color
  let changed = 1

  while (head < tail) {
    const current = queue[head++]
    const x = current % WIDTH
    const y = Math.floor(current / WIDTH)

    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const

    for (const [nx, ny] of neighbors) {
      if (!inBounds(nx, ny)) continue
      const ni = pixelIndex(nx, ny)
      if (buffer[ni] !== target) continue
      buffer[ni] = color
      queue[tail++] = ni
      changed += 1
    }
  }

  return changed
}

export function spray(buffer: Uint8Array, center: Point, color: number, radius = 7, count = 24) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2
    const r = Math.sqrt(Math.random()) * radius
    setPixel(
      buffer,
      Math.round(center.x + Math.cos(angle) * r),
      Math.round(center.y + Math.sin(angle) * r),
      color,
    )
  }
}

const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  '6': ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
  '?': ['01110', '10001', '00010', '00100', '00100', '00000', '00100'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '.': ['00000', '00000', '00000', '00000', '00000', '00110', '00110'],
  ',': ['00000', '00000', '00000', '00000', '00110', '00110', '00100'],
  ':': ['00000', '00110', '00110', '00000', '00110', '00110', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '#': ['01010', '01010', '11111', '01010', '11111', '01010', '01010'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
}

export function drawText(buffer: Uint8Array, origin: Point, text: string, color: number, scale = 1) {
  let cursorX = origin.x
  let cursorY = origin.y
  const upper = text.toUpperCase()

  for (const char of upper) {
    if (char === '\n') {
      cursorX = origin.x
      cursorY += 9 * scale
      continue
    }

    const glyph = FONT[char] ?? FONT['?']
    for (let gy = 0; gy < 7; gy += 1) {
      for (let gx = 0; gx < 5; gx += 1) {
        if (glyph[gy][gx] !== '1') continue
        for (let sy = 0; sy < scale; sy += 1) {
          for (let sx = 0; sx < scale; sx += 1) {
            setPixel(buffer, cursorX + gx * scale + sx, cursorY + gy * scale + sy, color)
          }
        }
      }
    }
    cursorX += 6 * scale
  }
}

export function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y
    const intersects =
      yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1e-9) + xi
    if (intersects) inside = !inside
  }
  return inside
}
