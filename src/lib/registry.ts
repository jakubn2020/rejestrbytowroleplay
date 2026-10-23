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

/** Issuer printed on certificates (fictional, for the roleplay). */
export const CERTIFICATE_ISSUER =
  'Wojewódzka Stacja Pogotowia Ratunkowego „Medicare” w Milanowie'

/** Entries moved to the trash are purged after this many days. */
export const TRASH_RETENTION_DAYS = 30

/** Public entry number shown in the registry and on certificates. */
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
  seal: 'Zmieniono pieczęć zaświadczeń',
  login: 'Zalogowano (kod z e-maila)',
  request_create: 'Złożono wniosek o wpis',
  request_approve: 'Zaakceptowano wniosek o wpis',
  request_reject: 'Odrzucono wniosek o wpis',
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
