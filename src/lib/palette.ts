export type PaletteEntry = {
  index: number
  hex: string
  name: string
  rgb: [number, number, number]
}

export const PALETTE: PaletteEntry[] = [
  { index: 0, hex: '#FFFFFF', name: 'white', rgb: [255, 255, 255] },
  { index: 1, hex: '#000000', name: 'black', rgb: [0, 0, 0] },
  { index: 2, hex: '#965E4B', name: 'trippie brown', rgb: [150, 94, 75] },
  { index: 3, hex: '#877549', name: 'old man olive', rgb: [135, 117, 73] },
  { index: 4, hex: '#C52020', name: 'juicy red', rgb: [197, 32, 32] },
  { index: 5, hex: '#FEC343', name: 'gold', rgb: [254, 195, 67] },
  { index: 6, hex: '#EE93E3', name: 'og pink', rgb: [238, 147, 227] },
  { index: 7, hex: '#E6A3C6', name: 'tongue pink', rgb: [230, 163, 198] },
  { index: 8, hex: '#07992F', name: 'green', rgb: [7, 153, 47] },
  { index: 9, hex: '#A0055D', name: 'nad magenta', rgb: [160, 5, 93] },
  { index: 10, hex: '#694B87', name: 'purple', rgb: [105, 75, 135] },
  { index: 11, hex: '#5FEDDF', name: 'DF1 cyan', rgb: [95, 237, 223] },
  { index: 12, hex: '#F7931A', name: 'BTC orange', rgb: [247, 147, 26] },
  { index: 13, hex: '#C864AA', name: 'waifu pink', rgb: [200, 100, 170] },
  { index: 14, hex: '#9F70DA', name: 'pill purple', rgb: [159, 112, 218] },
  { index: 15, hex: '#D47827', name: 'emoji orange', rgb: [212, 120, 39] },
]

export const WIDTH = 256
export const HEIGHT = 256
