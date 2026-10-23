/**
 * Fitting the taskbar tray on a phone. The tray holds more than a narrow screen has room for once a storm is on
 * (the countdown reads "STORM 02:59") and Live Mode adds its pill, and the phone layout clips whatever doesn't
 * fit from the left: first the mute button, then the storm countdown itself. Instead, parts marked
 * `data-tray-drop="<n>"` are hidden one at a time, lowest number first, until the row fits. The storm
 * countdown, the bell, the LIVE pill and the block number carry no mark, so they always stay.
 *
 * Only runs where the tray clips (the phone layout sets overflow hidden); on a desktop nothing is ever hidden.
 */

/** Pure: whether a row of items this wide, with `gap` px between them, is wider than `available`. */
export function rowOverflows(widths: number[], gap: number, available: number) {
  const visible = widths.filter((width) => width > 0)
  const need = visible.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, visible.length - 1)
  return need > available + 0.5
}

/** Pure: the marked parts in the order they go (lowest mark first, then left to right). */
export function dropOrder<T extends { drop: number }>(parts: T[]) {
  return parts
    .map((part, index) => ({ part, index }))
    .sort((a, b) => a.part.drop - b.part.drop || a.index - b.index)
    .map(({ part }) => part)
}

/** Hides marked parts of the tray, least important first, until it fits. Safe to call on every render. */
export function fitTray(tray: HTMLElement | null) {
  if (!tray || typeof getComputedStyle === 'undefined') return
  const marked = [...tray.querySelectorAll<HTMLElement>('[data-tray-drop]')]
  for (const element of marked) delete element.dataset.trayDropped
  const style = getComputedStyle(tray)
  if (style.overflowX !== 'hidden') return

  const gap = parseFloat(style.columnGap) || 0
  const available =
    tray.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)
  const overflowing = () =>
    rowOverflows(
      [...tray.children].map((child) => {
        // A dialog the tray opens is fixed-position: it takes no room in the row.
        const position = getComputedStyle(child).position
        return position === 'fixed' || position === 'absolute' ? 0 : child.getBoundingClientRect().width
      }),
      gap,
      available,
    )
  const parts = dropOrder(marked.map((element) => ({ element, drop: Number(element.dataset.trayDrop) || 0 })))
  for (const { element } of parts) {
    if (!overflowing()) return
    element.dataset.trayDropped = '1'
  }
}
