export const PROFESSIONS = [
  'Lekarz rezydent',
  'Lekarz',
  'Lekarz specjalista',
  'Ratownik medyczny (magister)',
  'Ratownik medyczny (licencjat)',
  'Pielęgniarz (magister)',
  'Pielęgniarz (licencjat)',
] as const

export type Profession = (typeof PROFESSIONS)[number]

/** Netlify Identity roles. `kierownictwo` may add entries (rate-limited) but never delete. */
export const ROLE_ADMIN = 'admin'
export const ROLE_MANAGEMENT = 'kierownictwo'

/** How long a `kierownictwo` user must wait between two added entries. */
export const MANAGEMENT_COOLDOWN_SECONDS = 5 * 60

/** Paramedics (any degree, including legacy "Ratownik medyczny" rows) have no specialization. */
export function isParamedic(profession: string): boolean {
  return profession.startsWith('Ratownik medyczny')
}

/** Upper bound on PESEL length, only to keep input sane. */
export const PESEL_MAX_LENGTH = 100

/**
 * PWZ = last 7 digits of the PESEL; a leading 0 becomes 1.
 * A PESEL shorter than 7 digits is left-padded with zeros first.
 */
export function pwzFromPesel(pesel: string): string {
  const tail = pesel.slice(-7).padStart(7, '0')
  return tail.startsWith('0') ? `1${tail.slice(1)}` : tail
}

/** A PWZ number is exactly 7 digits. */
export function isPwz(value: string) {
  return /^\d{7}$/.test(value)
}

/** A PESEL is any non-empty string of digits (no fixed length). */
export function isPesel(value: string) {
  return value.length > 0 && value.length <= PESEL_MAX_LENGTH && /^\d+$/.test(value)
}

/** Public, PESEL-free view of a registry entry. */
export type PublicEntry = {
  pwz: string
  firstName: string
  lastName: string
  profession: string
  specialization: string
}
