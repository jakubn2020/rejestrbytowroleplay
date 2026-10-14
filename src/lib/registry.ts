export const PROFESSIONS = [
  'Lekarz',
  'Lekarz dentysta',
  'Pielęgniarka',
  'Pielęgniarz',
  'Ratownik medyczny',
] as const

export type Profession = (typeof PROFESSIONS)[number]

export const PARAMEDIC: Profession = 'Ratownik medyczny'

/** PWZ = last 7 digits of the PESEL; a leading 0 becomes 1. */
export function pwzFromPesel(pesel: string): string {
  const tail = pesel.slice(-7)
  return tail.startsWith('0') ? `1${tail.slice(1)}` : tail
}

export function isPesel(value: string) {
  return /^\d{11}$/.test(value)
}

/** Public, PESEL-free view of a registry entry. */
export type PublicEntry = {
  pwz: string
  firstName: string
  lastName: string
  profession: string
  specialization: string
}
