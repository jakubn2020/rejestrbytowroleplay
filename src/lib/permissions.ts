/**
 * Permissions of the staff roles. Client-safe: the catalog and the pure rules that decide whether a
 * person may do something. The owner can switch a permission off for a whole role, and set an
 * exception for one person (blocked or allowed again), optionally only until a date.
 * A permission can never be given to a role that does not have it by default.
 */
import { ROLE_ADMIN, ROLE_EXAMINER, ROLE_EXAM_MOD, ROLE_MANAGEMENT } from './registry'

export const PERMISSION_ROLES = [
  { role: ROLE_MANAGEMENT, label: 'Kierownictwo' },
  { role: ROLE_ADMIN, label: 'Administrator' },
  { role: ROLE_EXAMINER, label: 'Egzaminator' },
  { role: ROLE_EXAM_MOD, label: 'Moderator egzaminatorów' },
] as const

export type PermissionDef = {
  key: string
  label: string
  group: string
  /** Roles that have the permission by default. */
  roles: readonly string[]
}

const M = ROLE_MANAGEMENT
const A = ROLE_ADMIN
const E = ROLE_EXAMINER
const X = ROLE_EXAM_MOD

export const PERMISSIONS: readonly PermissionDef[] = [
  { key: 'registry.view', label: 'Przeglądanie tabeli osób', group: 'Rejestr', roles: [M, A] },
  { key: 'pesel.reveal', label: 'Podgląd numeru PESEL', group: 'Rejestr', roles: [M, A] },
  { key: 'badges.view', label: 'Plakietki i kody QR', group: 'Rejestr', roles: [M, A] },
  { key: 'entries.add', label: 'Dodawanie osób bezpośrednio', group: 'Rejestr', roles: [A] },
  { key: 'entries.edit', label: 'Edycja wpisów i cofanie zmian', group: 'Rejestr', roles: [A] },
  { key: 'entries.bulk', label: 'Działania zbiorcze', group: 'Rejestr', roles: [A] },
  { key: 'entries.export', label: 'Eksport CSV', group: 'Rejestr', roles: [A] },
  { key: 'entries.trash', label: 'Kosz i trwałe usuwanie wpisów', group: 'Rejestr', roles: [A] },
  { key: 'requests.create', label: 'Składanie wniosków o wpis', group: 'Wnioski i zgłoszenia', roles: [M, E, X] },
  { key: 'requests.decide', label: 'Rozpatrywanie wniosków', group: 'Wnioski i zgłoszenia', roles: [A] },
  { key: 'reports.manage', label: 'Zgłoszenia od odwiedzających', group: 'Wnioski i zgłoszenia', roles: [A] },
  { key: 'audit.view', label: 'Dziennik zdarzeń i aktywność', group: 'Administracja', roles: [A] },
  { key: 'accounts.management', label: 'Konta kierownictwa', group: 'Administracja', roles: [A] },
  { key: 'examstaff.manage', label: 'Konta egzaminatorów i moderatorów', group: 'Administracja', roles: [A] },
  { key: 'examiners.add', label: 'Dodawanie egzaminatorów', group: 'Moderacja egzaminatorów', roles: [X] },
  { key: 'examiners.suspend', label: 'Zawieszanie egzaminatorów', group: 'Moderacja egzaminatorów', roles: [X] },
  { key: 'examiners.removal', label: 'Wnioski o usunięcie kont egzaminatorów', group: 'Moderacja egzaminatorów', roles: [X] },
]

export type PermissionKey = (typeof PERMISSIONS)[number]['key']

/** What was blocked for a whole role: role -> list of permission keys. */
export type RoleDenials = Record<string, string[]>

/** An exception for one person. `until` makes it temporary. */
export type PersonException = { mode: 'allow' | 'deny'; until?: string }
export type PersonExceptions = Record<string, PersonException>

export const permissionByKey = (key: string) => PERMISSIONS.find((p) => p.key === key)

/** Does a role have the permission by default (before any switch)? */
export function roleHasByDefault(role: string, key: string): boolean {
  return permissionByKey(key)?.roles.includes(role) ?? false
}

export function exceptionActive(exception: PersonException | undefined, now = Date.now()): exception is PersonException {
  if (!exception) return false
  if (!exception.until) return true
  const until = Date.parse(exception.until)
  return Number.isFinite(until) && until > now
}

export type Resolution = {
  allowed: boolean
  /** Why: the default of the role, a role switch, or the person's exception. */
  source: 'rola' | 'wylaczone-w-roli' | 'brak-w-roli' | 'wyjatek-zablokowane' | 'wyjatek-dozwolone' | 'wlasciciel'
  /** Set when the deciding exception is temporary. */
  until?: string
}

/**
 * The effective decision for one permission. The owner is never limited. A person's active exception wins over the
 * role switch, but "allow" only works for a permission that one of the person's roles has by default.
 */
export function resolvePermission(
  key: string,
  input: { roles: readonly string[]; isOwner: boolean; denials: RoleDenials; exceptions: PersonExceptions },
  now = Date.now(),
): Resolution {
  if (input.isOwner) return { allowed: true, source: 'wlasciciel' }
  const granting = input.roles.filter((role) => roleHasByDefault(role, key))
  const exception = input.exceptions[key]
  if (exceptionActive(exception, now)) {
    if (exception.mode === 'deny') return { allowed: false, source: 'wyjatek-zablokowane', until: exception.until }
    if (granting.length > 0) return { allowed: true, source: 'wyjatek-dozwolone', until: exception.until }
  }
  if (granting.length === 0) return { allowed: false, source: 'brak-w-roli' }
  const open = granting.some((role) => !(input.denials[role] ?? []).includes(key))
  return open ? { allowed: true, source: 'rola' } : { allowed: false, source: 'wylaczone-w-roli' }
}

export function deniedKeys(
  input: { roles: readonly string[]; isOwner: boolean; denials: RoleDenials; exceptions: PersonExceptions },
  now = Date.now(),
): string[] {
  return PERMISSIONS.filter((p) => {
    // Only keys the person's roles could have: the others are denied for a different reason.
    if (!input.roles.some((role) => p.roles.includes(role))) return false
    return !resolvePermission(p.key, input, now).allowed
  }).map((p) => p.key)
}

export const SOURCE_LABELS: Record<Resolution['source'], string> = {
  rola: 'z roli',
  'wylaczone-w-roli': 'wyłączone w roli',
  'brak-w-roli': 'brak w roli',
  'wyjatek-zablokowane': 'zablokowane osobie',
  'wyjatek-dozwolone': 'dozwolone osobie',
  wlasciciel: 'właściciel',
}
