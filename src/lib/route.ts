/** A non-negative integer from a URL/hash param; anything else (letters, decimals, huge values) is 0. */
export function safeRouteInt(raw: string | null | undefined) {
  return raw && /^\d{1,15}$/.test(raw) ? Number(raw) : 0
}
