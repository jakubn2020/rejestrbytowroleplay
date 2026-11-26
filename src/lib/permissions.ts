/** Client-safe catalog of the permissions the owner can switch on and off (per role or per person). */

export const PERMISSIONS = [
  { key: 'view_registry', label: 'Przeglądanie tabeli osób i wyszukiwanie', roles: ['kierownictwo', 'admin'] },
  { key: 'pesel_reveal', label: 'Podgląd numeru PESEL', roles: ['kierownictwo', 'admin'] },
  { key: 'badge', label: 'Plakietki i kody QR', roles: ['kierownictwo', 'admin'] },
  { key: 'request_create', label: 'Składanie wniosków o wpis', roles: ['kierownictwo', 'egzaminator', 'moderator-egzaminatorow'] },
  { key: 'expiry_request', label: 'Wnioski o zmianę terminu PWZ', roles: ['kierownictwo'] },
  { key: 'edit_entries', label: 'Edycja wpisów', roles: ['admin'] },
  { key: 'delete_entries', label: 'Usuwanie wpisów (kosz)', roles: ['admin'] },
  { key: 'bulk_export', label: 'Działania zbiorcze i eksport CSV', roles: ['admin'] },
  { key: 'decide_requests', label: 'Rozpatrywanie wniosków o wpis', roles: ['admin'] },
  { key: 'manage_examiners', label: 'Zarządzanie kontami egzaminatorów (administrator)', roles: ['admin'] },
  { key: 'moderate_examiners', label: 'Dodawanie, zawieszanie i wnioski o usunięcie egzaminatorów', roles: ['moderator-egzaminatorow'] },
] as const

export type PermissionKey = (typeof PERMISSIONS)[number]['key']

export const PERMISSION_ROLES = [
  { role: 'kierownictwo', label: 'Kierownictwo' },
  { role: 'admin', label: 'Administrator' },
  { role: 'egzaminator', label: 'Egzaminator' },
  { role: 'moderator-egzaminatorow', label: 'Moderator egzaminatorów' },
] as const

export type PermissionRole = (typeof PERMISSION_ROLES)[number]['role']

/** One exception for one person: allow or deny, optionally only until a moment in time. */
export type UserOverride = { allow: boolean; until?: string }

export const permissionLabel = (key: string) => PERMISSIONS.find((p) => p.key === key)?.label ?? key

/** Settings keys. */
export const permKey = {
  role: (role: string) => `perm_role_${role}`,
  user: (id: string) => `perm_user_${id}`,
  history: 'perm_history',
  ipRole: (role: string) => `ip_role_${role}`,
}

export type PermissionSource = 'owner' | 'person' | 'role' | 'default' | 'n/a'

export type ResolvedPermission = {
  key: PermissionKey
  label: string
  allowed: boolean
  source: PermissionSource
  /** For a person's exception that expires. */
  until?: string
}

export type PermissionHistoryEntry = {
  id: string
  at: string
  by: string
  scope: 'role' | 'person'
  /** Role id or account id. */
  target: string
  targetLabel: string
  summary: string
  /** What to restore when the change is undone (the raw stored value, null = nothing was stored). */
  before: string | null
  settingKey: string
  undone?: boolean
}
