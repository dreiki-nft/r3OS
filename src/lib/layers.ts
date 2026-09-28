import { HEIGHT, WIDTH } from './palette'

export const INITIAL_FACE_COLOR = 1

const OUTLINE_RUNS_HEX =
  '5a70735b6d775c69795d5c7a5e587b5f55705f747c60546d60777d61526961787e62505b62797f634f58637b80644e56647b81654d54657c82664d52667d8166929f674c51677e816790a3684c50685364688ea9694b6a698dba6a4b6d6a8cbd6b4a706b8b926b9fbf6c49726c8a906ca3c06d47536d64736d898f6d91946da9c26e464e6e6a756e899a6ebac36f45536f6d766f889e6fbdc47044597070777088a270bec471435e7171787187a571c0c3723e617273797287907294a9733c6473747a73868d739aae743b4a74546874757b74858b749eb4753a4b75596b75767c75858a75a2bb763a4c76596e76777c76848976a5c177393e77474c77587177787d77848877a9c578393d78484c78587478797d78838878aec779383d79484d79587779797e79838779b5c97a383c7a494d7a587e7a82877a90987abbca7b383c7b494d7b586c7b6e7e7b82867b89a17bc2cb7c373c7c494e7c586c7c717e7c82a87cbbcd7d373b7d4a4f7d586c7d747e7d82ce7e373b7e4a517e586b7e777e7e82cf7f373b7f4b6b7f797e7f82d080383c804c6a807a7e8082898090d081383d814d6a81797e818286818fa481a8bb81c6d1823840824e6982797d828286828fa582c5d2833942835159835c6883787d838286838fa583c3d2843943845e6984787d848287848fa584c2ca84ced3853a4485606f85777c858387858ea585c1c885cfd4863d4586617c868387868fa586bfc786d0d4873e4587637f878387878fa487bec587d0d5883d46886681888387888fa488bcc488d1d5893b46896987898da389bbc389d1d68a3a478a6fa38ab9c18ad2d68b39408b43488b7ca78bb7c08bd2d68c383f8c43498c7fab8cb4be8cc8c98cd2d68d373d8d444a8d81948d9abd8dc7cb8dd2d68e373c8e454b8e848d8ea0bb8ec7cb8ed2d68f363b8f464c8fa3b98fc6cb8fd1d690363a90474e90a7b790c4ca90d1d591353a91485391abb491c3c991d0d592353992496492c0c992cfd4933539934a6993bdc893cfd4943539944c6c94bbc694cfd3953539954f6e95b9c595ced296353996537096b7c396ced297353997657297b5c097ced298353998697598b4bd98ced2993539996c77998f9999b3bb99ced29a35399a6e7a9a8c9d9ab2b99aced29b353a9b70809b879f9bb0b79bced29c363b9c72a19cafb69ccdd29d363d9d75a39dadb59dcdd19e373f9e778f9e99a79eaab39ecdd19f38409f7b8c9f9db29fccd1a03941a08187a09fb1a0cbd1a13b41a1a1afa1cad0a23d42a2a3aea2c8cfa33e42a3a8a9a3c6cfa43e43a4c3cda53f43a5c1cca63f43a6bfcaa73f44a7bdc8a84044a8bcc6a94044a9a1a2a9bbc3aa4045aa666daa9da7aabac1ab4146ab626fab9bababb9bfac4146ac5f70ac9aacacb8bead4247ad5d71ad98aeadb7bdae4249ae5b72ae96a0aea3bcaf434daf5865af6d73af949dafa7bbb04462b06e74b0929cb0aabab1455fb16f74b18f9ab1acb9b2475db27075b28c98b2aeb7b34a5bb37176b38896b3b3b4b44e58b47178b48494b57292b6738fb7748cb87688b97783'

function decodeRuns(hex: string) {
  const out: Array<{ y: number; x0: number; x1: number }> = []
  for (let i = 0; i < hex.length; i += 6) {
    out.push({
      y: Number.parseInt(hex.slice(i, i + 2), 16),
      x0: Number.parseInt(hex.slice(i + 2, i + 4), 16),
      x1: Number.parseInt(hex.slice(i + 4, i + 6), 16),
    })
  }
  return out
}

function buildMask(hex: string) {
  const mask = new Uint8Array(WIDTH * HEIGHT)
  for (const { y, x0, x1 } of decodeRuns(hex)) {
    for (let x = x0; x <= x1; x += 1) {
      mask[y * WIDTH + x] = 1
    }
  }
  return mask
}

export const OUTLINE_MASK = buildMask(OUTLINE_RUNS_HEX)

export function isOutlinePixel(x: number, y: number) {
  return OUTLINE_MASK[y * WIDTH + x] === 1
}

export function isProtectedPixel(x: number, y: number) {
  return isOutlinePixel(x, y)
}

export function compositeColor(backgroundColor: number, x: number, y: number, faceColor: number) {
  if (isOutlinePixel(x, y)) return faceColor
  return backgroundColor
}

export function compositeCanvas(background: Uint8Array, faceColor: number) {
  const out = new Uint8Array(background.length)
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const i = y * WIDTH + x
      out[i] = compositeColor(background[i], x, y, faceColor)
    }
  }
  return out
}
