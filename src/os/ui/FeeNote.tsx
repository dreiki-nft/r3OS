/**
 * Fee quotes are worked out at the gas price r3OS suggests. A wallet can replace that with its own setting
 * ("fast", "aggressive"…) and then shows a different, sometimes higher, number. Monad charges by the gas limit,
 * so the wallet's figure is the one that counts. Said once, next to the quote, so the two numbers don't look like
 * a mistake.
 */
export const FEE_NOTE =
  "estimate at the gas price r3OS suggests. your wallet shows the final fee, which can be higher if it uses a faster gas setting."

export function FeeNote() {
  return <small className="fee-note">{FEE_NOTE}</small>
}
