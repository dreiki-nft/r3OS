export const DF1_REFERENCE_NOISE_RADIUS = 25
export const DF1_REFERENCE_OUTLIER_RATE = 0.009919410150891633
export const DF1_MAX_AMOUNT = 200
export const DF1_VERSION = 1

function clampByte(value: number) {
  return Math.max(0, Math.min(255, value))
}

function randomInt(rand: () => number, min: number, max: number) {
  return min + Math.floor(rand() * (max - min + 1))
}

/** DF1 v1 PRNG (mulberry32). Frozen: changing this invalidates every saved seed. */
export function seededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function applyDf1(source: Uint8ClampedArray, seed: number, amountPercent: number) {
  const amount = Math.max(0, Math.min(DF1_MAX_AMOUNT, amountPercent))
  const output = new Uint8ClampedArray(source.length)
  output.set(source)
  if (amount === 0) return output
  const factor = amount / 100
  const noiseRadius = Math.round(DF1_REFERENCE_NOISE_RADIUS * factor)
  const outlierRate = Math.min(1, DF1_REFERENCE_OUTLIER_RATE * factor)
  const rand = seededRandom(seed || 1)
  for (let offset = 0; offset < output.length; offset += 4) {
    const red = source[offset],
      green = source[offset + 1],
      blue = source[offset + 2],
      alpha = source[offset + 3]
    if (rand() < outlierRate) {
      output[offset] = randomInt(rand, 0, 255)
      output[offset + 1] = randomInt(rand, 0, 255)
      output[offset + 2] = randomInt(rand, 0, 255)
    } else {
      output[offset] = clampByte(red + randomInt(rand, -noiseRadius, noiseRadius))
      output[offset + 1] = clampByte(green + randomInt(rand, -noiseRadius, noiseRadius))
      output[offset + 2] = clampByte(blue + randomInt(rand, -noiseRadius, noiseRadius))
    }
    if (alpha === 0) {
      output[offset] = red
      output[offset + 1] = green
      output[offset + 2] = blue
    }
    output[offset + 3] = alpha
  }
  return output
}
