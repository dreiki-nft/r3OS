/** Plain-language season timing for empty states ("season 2 ends in 3 d 4 h"). Pure, so it is unit-tested. */
export interface SeasonTiming {
  SEASON_START: bigint
  SEASON_LENGTH: bigint
}

export function seasonClock(nowSeconds: number, timing: SeasonTiming) {
  const start = Number(timing.SEASON_START)
  const length = Number(timing.SEASON_LENGTH)
  if (!(length > 0)) return undefined
  if (nowSeconds < start) {
    return { season: 1, endsAt: start + length, label: `season 1 starts in ${duration(start - nowSeconds)}` }
  }
  const index = Math.floor((nowSeconds - start) / length)
  const endsAt = start + (index + 1) * length
  return { season: index + 1, endsAt, label: `season ${index + 1} ends in ${duration(endsAt - nowSeconds)}` }
}

export function duration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds))
  const days = Math.floor(s / 86_400)
  const hours = Math.floor((s % 86_400) / 3_600)
  const minutes = Math.floor((s % 3_600) / 60)
  if (days > 0) return `${days} d ${hours} h`
  if (hours > 0) return `${hours} h ${minutes} min`
  return `${Math.max(1, minutes)} min`
}
