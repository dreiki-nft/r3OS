/**
 * QR code for https://r3os.app (version 2, error correction M), precomputed so the broadcast view needs no QR
 * library and can never encode anything else. 1 = dark module. Regenerate with any QR encoder if the domain
 * ever changes; `src/tv/tvModel.test.ts` checks the finder patterns so a typo can't ship.
 */
export const QR_URL = 'https://r3os.app'
export const QR_LABEL = 'r3os.app'

export const QR_ROWS: readonly string[] = [
  '1111111000101001101111111',
  '1000001000001000001000001',
  '1011101011011010101011101',
  '1011101011011000001011101',
  '1011101011010111001011101',
  '1000001010101111001000001',
  '1111111010101010101111111',
  '0000000011111101000000000',
  '1011111001010011101111100',
  '1011110111000000110000010',
  '0110011001100001001011011',
  '1011110100101011010000001',
  '0001001111000001111110111',
  '1010100011101110100101010',
  '1011101001000111110111011',
  '1011110101101101010110001',
  '1011001111001011111110100',
  '0000000011000001100011000',
  '1111111000111000101010111',
  '1000001010110010100011001',
  '1011101011010001111110101',
  '1011101010001111111011111',
  '1011101010100110110001101',
  '1000001000001101101111001',
  '1111111010101011010111111',
]

/** One SVG path with a 1×1 square per dark module (viewBox is the matrix size plus a 2-module quiet zone). */
export function qrPath(rows: readonly string[] = QR_ROWS, quiet = 2) {
  let path = ''
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '1') path += `M${x + quiet} ${y + quiet}h1v1h-1z`
  })
  return path
}
