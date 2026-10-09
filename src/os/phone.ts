/**
 * Phones get one full-screen window at a time and single-column programs (see phone.css).
 * Portrait phones are narrow; landscape phones are short touch screens. Keep this query in sync with phone.css.
 */
export const PHONE_QUERY = '(max-width: 640px), (max-height: 500px) and (pointer: coarse)'

export function isPhoneScreen() {
  try {
    return typeof matchMedia === 'function' && matchMedia(PHONE_QUERY).matches
  } catch {
    return false
  }
}
