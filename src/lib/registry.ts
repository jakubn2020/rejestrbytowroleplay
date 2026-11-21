export const PROFESSIONS = [
  'Lekarz rezydent',
  'Lekarz',
  'Lekarz specjalista',
  'Ratownik medyczny',
  'Pielęgniarz',
] as const

export type Profession = (typeof PROFESSIONS)[number]

/** Netlify Identity roles. `kierownictwo` submits requests for new entries (an admin approves them) and makes badges. */
export const ROLE_ADMIN = 'admin'
export const ROLE_MANAGEMENT = 'kierownictwo'

/** Manual entry statuses (there is deliberately no automatic expiry date). `expired` is shown as "Nieaktywny". */
export const ENTRY_STATUSES = {
  active: 'Aktywny',
  suspended: 'Zawieszony',
  expired: 'Nieaktywny',
} as const

export type EntryStatus = keyof typeof ENTRY_STATUSES

export const ENTRY_STATUS_KEYS = ['active', 'suspended', 'expired'] as const

/** Issuer printed on badges (fictional, for the roleplay). */
export const CERTIFICATE_ISSUER =
  'Wojewódzka Stacja Pogotowia Ratunkowego „Medicare” w Milanowie'

/** Entries moved to the trash are purged after this many days. */
export const TRASH_RETENTION_DAYS = 30

/** Public entry number shown in the registry. */
export function entryNumber(id: number): string {
  return String(id).padStart(6, '0')
}

/** Dates are always shown in Polish time, so server and browser agree. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pl-PL', {
    timeZone: 'Europe/Warsaw',
    dateStyle: 'short',
    timeStyle: 'medium',
  })
}

/** Audit-log actions and their Polish labels. */
export const AUDIT_ACTION_LABELS = {
  add: 'Dodano osobę',
  update: 'Edytowano wpis',
  delete: 'Usunięto osobę (do kosza)',
  restore: 'Przywrócono osobę z kosza',
  purge: 'Usunięto osobę trwale',
  add_management: 'Dodano konto kierownictwa',
  delete_management: 'Usunięto konto kierownictwa',
  reset_password: 'Ustawiono nowe hasło kierownictwa',
  add_admin: 'Dodano konto administratora',
  delete_admin: 'Usunięto konto administratora',
  reset_admin_password: 'Ustawiono nowe hasło administratora',
  change_password: 'Zmieniono własne hasło',
  seal: 'Zmieniono pieczęć (funkcja usunięta)',
  login: 'Zalogowano do panelu',
  pesel_view: 'Odsłonięto PESEL',
  sessions_revoked: 'Wylogowano ze wszystkich urządzeń',
  request_create: 'Złożono wniosek o wpis',
  expiry_request_create: 'Złożono wniosek o zmianę terminu PWZ',
  expiry_request_approve: 'Zaakceptowano wniosek o zmianę terminu PWZ',
  expiry_request_reject: 'Odrzucono wniosek o zmianę terminu PWZ',
  request_approve: 'Zaakceptowano wniosek o wpis',
  request_reject: 'Odrzucono wniosek o wpis',
  maintenance: 'Tryb awaryjny rejestru',
  revoke_account: 'Wylogowano konto ze wszystkich urządzeń',
  logout_everyone: 'Wylogowano wszystkich użytkowników',
} as const

export type AuditAction = keyof typeof AUDIT_ACTION_LABELS

/** How long a `kierownictwo` user must wait between two submitted requests. */
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
  status: EntryStatus
  /** Zero-padded id, e.g. "000123". */
  entryNumber: string
  /** ISO timestamp of when the entry was created. */
  entryDate: string
  /** ISO timestamp when the PWZ expires; null = lifetime. */
  expiresAt: string | null
}

/** Stored status, except that an active entry whose validity has run out is "expired". */
export function effectiveStatus(
  stored: EntryStatus,
  expiresAt: Date | string | null,
  now: Date = new Date(),
): EntryStatus {
  if (stored === 'active' && expiresAt && new Date(expiresAt) <= now) return 'expired'
  return stored
}

/** "dożywotnio" or "do 12.02.2027" */
export function validityLabel(expiresAt: string | null): string {
  return expiresAt ? `do ${formatDate(expiresAt)}` : 'dożywotnio'
}

/** Request statuses (kierownictwo asks, an admin decides). */
export const REQUEST_STATUSES = {
  pending: 'Oczekuje',
  approved: 'Zaakceptowany',
  rejected: 'Odrzucony',
} as const

export type RequestStatus = keyof typeof REQUEST_STATUSES

export function toRequestStatus(value: string): RequestStatus {
  return value in REQUEST_STATUSES ? (value as RequestStatus) : 'pending'
}

export type ProfessionKind = 'doctor' | 'nurse' | 'paramedic'

export function professionKind(profession: string): ProfessionKind {
  if (profession.startsWith('Ratownik')) return 'paramedic'
  if (profession.startsWith('Pielęgniarz')) return 'nurse'
  return 'doctor'
}

/** Professional title printed on badges: lekarz, pielęgniarz or ratownik medyczny. */
export const BADGE_TITLES: Record<ProfessionKind, string> = {
  doctor: 'Lekarz',
  nurse: 'Pielęgniarz',
  paramedic: 'Ratownik medyczny',
}

/** Path of the public page a badge's QR code points to. */
export function verificationPath(pwz: string): string {
  return `/weryfikacja/${pwz}`
}

export const EXPIRY_MODES = ['lifetime', 'months3', 'custom'] as const
export type RequestedExpiryMode = (typeof EXPIRY_MODES)[number]
export const EXPIRY_UNITS = ['days', 'months'] as const
export type ExpiryUnitKey = (typeof EXPIRY_UNITS)[number]
export const MAX_EXPIRY_DAYS = 36_500
export const MAX_EXPIRY_MONTHS = 1_200

/** The date a validity choice leads to, counted from `from`; null = lifetime. */
export function expiryFromChoice(
  mode: RequestedExpiryMode,
  amount: number | null,
  unit: ExpiryUnitKey | null,
  from: Date = new Date(),
): Date | null {
  if (mode === 'lifetime') return null
  const date = new Date(from)
  if (mode === 'months3') {
    date.setMonth(date.getMonth() + 3)
    return date
  }
  if (unit === 'days') date.setDate(date.getDate() + (amount ?? 0))
  else date.setMonth(date.getMonth() + (amount ?? 0))
  return date
}

/** "dożywotnio", "za 3 miesiące", "za 45 dni" … */
export function describeExpiryChoice(
  mode: string,
  amount: number | null,
  unit: string | null,
): string {
  if (mode === 'lifetime') return 'dożywotnio'
  if (mode === 'months3') return 'wygasa za 3 miesiące'
  return `wygasa za ${amount ?? '?'} ${unit === 'days' ? 'dni' : 'mies.'}`
}

/** Badge of a kierownictwo account, based on how many of its requests were approved. */
export function managementBadge(approved: number): string | null {
  if (approved >= 100) return 'Mistrz wniosków'
  if (approved >= 50) return 'Doświadczony'
  if (approved >= 10) return 'Sprawny'
  if (approved >= 1) return 'Początkujący'
  return null
}
