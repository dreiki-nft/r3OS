import { HEIGHT, WIDTH } from './palette'

/**
 * Background storage starts blank white. The visible r3tard is now composed
 * from immutable onchain masks plus a binary face-fill color state.
 */
export function createGenesisCanvas() {
  return new Uint8Array(WIDTH * HEIGHT)
}
