import { HEIGHT, WIDTH } from './palette'

const idx = (x: number, y: number) => y * WIDTH + x

function setPixel(canvas: Uint8Array, x: number, y: number, color = 1) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return
  canvas[idx(x, y)] = color
}

function rect(canvas: Uint8Array, x0: number, y0: number, x1: number, y1: number, color = 1) {
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) setPixel(canvas, x, y, color)
  }
}

function line(
  canvas: Uint8Array,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color = 1,
  thickness = 1,
) {
  let dx = Math.abs(x1 - x0)
  const sx = x0 < x1 ? 1 : -1
  let dy = -Math.abs(y1 - y0)
  const sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  const half = Math.floor(thickness / 2)

  while (true) {
    rect(canvas, Math.max(0, x0 - half), Math.max(0, y0 - half), Math.min(255, x0 + half), Math.min(255, y0 + half), color)
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

/** Mirrors the Solidity constructor drawing exactly for demo mode. */
export function createGenesisCanvas() {
  const canvas = new Uint8Array(WIDTH * HEIGHT)
  const black = 1

  rect(canvas, 90, 28, 166, 33, black)
  rect(canvas, 82, 34, 89, 104, black)
  rect(canvas, 167, 34, 174, 104, black)
  rect(canvas, 90, 105, 166, 112, black)
  rect(canvas, 75, 52, 81, 76, black)
  rect(canvas, 175, 52, 181, 76, black)
  rect(canvas, 96, 22, 104, 31, black)
  rect(canvas, 112, 18, 122, 31, black)
  rect(canvas, 132, 20, 142, 31, black)
  rect(canvas, 151, 23, 160, 31, black)
  rect(canvas, 103, 55, 112, 69, black)
  rect(canvas, 143, 55, 152, 69, black)
  rect(canvas, 126, 68, 130, 83, black)
  rect(canvas, 108, 90, 148, 94, black)
  rect(canvas, 108, 86, 112, 90, black)
  rect(canvas, 144, 86, 148, 90, black)
  rect(canvas, 111, 113, 119, 128, black)
  rect(canvas, 137, 113, 145, 128, black)
  rect(canvas, 91, 128, 165, 135, black)
  rect(canvas, 91, 136, 98, 192, black)
  rect(canvas, 158, 136, 165, 192, black)
  rect(canvas, 98, 193, 158, 200, black)
  line(canvas, 91, 138, 62, 177, black, 5)
  line(canvas, 165, 138, 194, 177, black, 5)
  rect(canvas, 53, 174, 67, 181, black)
  rect(canvas, 189, 174, 203, 181, black)
  rect(canvas, 119, 150, 137, 155, black)
  rect(canvas, 125, 144, 131, 162, black)
  line(canvas, 112, 199, 103, 228, black, 7)
  line(canvas, 144, 199, 153, 228, black, 7)
  rect(canvas, 88, 226, 108, 233, black)
  rect(canvas, 148, 226, 168, 233, black)

  return canvas
}
