#!/usr/bin/env node
/**
 * Turn an exported Season Replay into an animated GIF for the README / socials.
 *
 *   node scripts/replay-gif.mjs                       # public/replay/season-0.json → docs/media/season-replay.gif
 *   node scripts/replay-gif.mjs --season 0 --frames 60 --scale 2 --out docs/media/season-replay.gif
 *   node scripts/replay-gif.mjs --from-block 112100000 --to-block 112316000 --out docs/media/launch-24h.gif
 *     (animates only that block range, starting from the canvas as it stood at --from-block)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import gifenc from 'gifenc'
import { paletteRgb, replayFrames } from './replay-lib.mjs'

const { GIFEncoder } = gifenc
const options = { season: 0, frames: 60, scale: 2, out: 'docs/media/season-replay.gif' }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 2) {
  const [flag, value] = [argv[i], argv[i + 1]]
  if (value == null) throw new Error(`${flag} needs a value`)
  if (flag === '--season') options.season = Number(value)
  else if (flag === '--frames') options.frames = Number(value)
  else if (flag === '--scale') options.scale = Number(value)
  else if (flag === '--out') options.out = value
  else if (flag === '--from-block') options.fromBlock = BigInt(value)
  else if (flag === '--to-block') options.toBlock = BigInt(value)
  else throw new Error(`unknown flag ${flag}`)
}
if (![1, 2, 3].includes(options.scale)) throw new Error('--scale must be 1, 2 or 3')
if (!Number.isInteger(options.frames) || options.frames < 2 || options.frames > 300)
  throw new Error('--frames must be 2-300')

const replay = JSON.parse(readFileSync(`public/replay/season-${options.season}.json`, 'utf8'))
if (!replay.events?.length) throw new Error('replay has no events; run scripts/export-replay.mjs first')
const palette = paletteRgb()
const size = 256 * options.scale
const gif = GIFEncoder()
const frames = replayFrames(
  replay,
  options.frames,
  options.fromBlock != null || options.toBlock != null
    ? { fromBlock: options.fromBlock, toBlock: options.toBlock }
    : undefined,
)
frames.forEach((frame, index) => {
  const scaled = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) {
    const row = ((y / options.scale) | 0) * 256
    for (let x = 0; x < size; x++) scaled[y * size + x] = frame[row + ((x / options.scale) | 0)]
  }
  const last = index === frames.length - 1
  gif.writeFrame(scaled, size, size, {
    palette,
    delay: last ? 2_500 : 80,
    ...(index === 0 ? { repeat: 0 } : {}),
  })
})
gif.finish()
mkdirSync(dirname(options.out), { recursive: true })
writeFileSync(options.out, gif.bytes())
console.log(
  `wrote ${options.out}: ${frames.length} frames, ${size}×${size}, ${(gif.bytes().length / 1024).toFixed(0)} KB`,
)
