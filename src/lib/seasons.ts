/** Seasonal colour themes: switch on by themselves around a holiday (unless the visitor chose a colour). */
export type Season = {
  id: string
  name: string
  hue: number
  /** [month 1-12, day] inclusive */
  from: [number, number]
  to: [number, number]
}

export const SEASONS: Season[] = [
  { id: 'niepodleglosc', name: 'Dzień Niepodległości', hue: 22, from: [11, 9], to: [11, 11] },
  { id: 'swieta', name: 'Święta Bożego Narodzenia', hue: 150, from: [12, 18], to: [1, 6] },
  { id: 'pielegniarki', name: 'Dzień Pielęgniarek (12 maja)', hue: 205, from: [5, 10], to: [5, 13] },
]

function dayNumber(month: number, day: number) {
  return month * 100 + day
}

/** The season that is on today (a range may wrap around the new year), or null. */
export function activeSeason(date = new Date()): Season | null {
  const today = dayNumber(date.getMonth() + 1, date.getDate())
  for (const season of SEASONS) {
    const from = dayNumber(...season.from)
    const to = dayNumber(...season.to)
    const inRange = from <= to ? today >= from && today <= to : today >= from || today <= to
    if (inRange) return season
  }
  return null
}
