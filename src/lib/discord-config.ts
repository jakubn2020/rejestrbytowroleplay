/** Shared (client + server) description of the Discord alert settings. */

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical'

/** Every alert kind that can be sent to Discord, with its label and default severity. */
export const DISCORD_ALERT_KINDS: { kind: string; label: string; severity: AlertSeverity }[] = [
  { kind: 'ip_locked', label: 'Atak siłowy: adres zablokowany do ręcznego odblokowania', severity: 'critical' },
  { kind: 'superadmin_granted', label: 'Nadano uprawnienia superadmina (współwłaściciel)', severity: 'critical' },
  { kind: 'two_countries', label: 'Logowania z dwóch krajów w krótkim czasie', severity: 'critical' },
  { kind: 'mass_delete', label: 'Masowe usuwanie wpisów', severity: 'critical' },
  { kind: 'lockdown', label: 'Tryb blokady (lockdown)', severity: 'critical' },
  { kind: 'mfa_lockout', label: 'Zgadywanie kodu z e-maila', severity: 'high' },
  { kind: 'pesel_mass_view', label: 'Masowe odsłanianie numerów PESEL', severity: 'high' },
  { kind: 'pesel_sequence', label: 'Skanowanie PESEL kolejnych wpisów', severity: 'high' },
  { kind: 'pesel_quota', label: 'Wyczerpany dzienny limit odsłonięć PESEL', severity: 'high' },
  { kind: 'new_country', label: 'Logowanie z nowego kraju', severity: 'high' },
  { kind: 'tor_login', label: 'Logowanie przez sieć Tor', severity: 'high' },
  { kind: 'approval_requested', label: 'Wniosek o zgodę innych adminów (zasada dwóch osób)', severity: 'medium' },
  { kind: 'mass_status', label: 'Masowa zmiana statusów', severity: 'high' },
  { kind: 'pwz_guessing', label: 'Zgadywanie numerów PWZ/PESEL', severity: 'high' },
  { kind: 'ip_autoban', label: 'Automatyczna (czasowa) blokada adresu IP', severity: 'medium' },
  { kind: 'login_failures_ip', label: 'Wiele nieudanych logowań z jednego adresu', severity: 'medium' },
  { kind: 'login_failures_account', label: 'Wiele nieudanych logowań na jedno konto', severity: 'medium' },
  { kind: 'lookup_limit', label: 'Zgadywanie numerów PESEL/PWZ (wyszukiwarka)', severity: 'medium' },
  { kind: 'pesel_changed', label: 'Zmiana numeru PESEL we wpisie', severity: 'medium' },
  { kind: 'qr_mass_check', label: 'Masowe sprawdzanie kodów QR', severity: 'medium' },
  { kind: 'new_device', label: 'Logowanie z nowego urządzenia', severity: 'medium' },
  { kind: 'new_ip', label: 'Logowanie z nowego adresu IP', severity: 'low' },
  { kind: 'odd_hours', label: 'Logowanie o nietypowej porze', severity: 'low' },
]

export const DISCORD_KIND_IDS = DISCORD_ALERT_KINDS.map((k) => k.kind)

export type DiscordPerson = {
  /** Stable internal id (not the Discord id). */
  id: string
  /** Name shown in the panel, e.g. a Discord username. */
  label: string
  /** Numeric Discord user id (Discord needs it to ping; a username alone cannot be pinged). Empty = not set yet. */
  discordId: string
  /** Master switch for this person: off = never pinged, whatever the per-alert switches say. */
  enabled: boolean
}

export const ALERT_SEVERITIES: readonly AlertSeverity[] = ['low', 'medium', 'high', 'critical']

export const SEVERITY_NAMES: Record<AlertSeverity, string> = {
  low: 'niska',
  medium: 'średnia',
  high: 'wysoka',
  critical: 'krytyczna',
}

export type DiscordKindRule = {
  /**
   * The owner's own severity for this kind of alert (overrides the built-in one everywhere: the alerts list,
   * the e-mail subject and Discord). Missing = the built-in severity. "Critical" is what pings the Discord role.
   */
  severity?: AlertSeverity
  /** Send this kind of alert to Discord at all. */
  send: boolean
  /** Ids (`DiscordPerson.id`) of the people pinged for this kind. */
  ping: string[]
}

/** A Discord role pinged on every critical alert (set by the owner in the security centre). */
export type DiscordCriticalRole = {
  enabled: boolean
  /** Numeric Discord role id. Empty = not set yet. */
  roleId: string
}

export type DiscordConfig = {
  /** Master switch for all Discord notifications. */
  enabled: boolean
  /** Role pinged on critical alerts; such alerts are sent even when the per-alert switch is off. */
  criticalRole: DiscordCriticalRole
  people: DiscordPerson[]
  kinds: Record<string, DiscordKindRule>
}

export const DISCORD_ID_PATTERN = /^\d{15,25}$/

/** The two people pinged by default (their numeric ids are filled in by the owner in the panel). */
export const DEFAULT_PEOPLE: DiscordPerson[] = [
  { id: 'peter180ty', label: 'peter180ty', discordId: '', enabled: true },
  { id: 'navalxz', label: 'navalxz', discordId: '', enabled: true },
]

/** Default: medium and above are sent, high and critical alerts ping everybody on the list. */
export function defaultDiscordConfig(): DiscordConfig {
  const people = DEFAULT_PEOPLE.map((p) => ({ ...p }))
  const kinds: Record<string, DiscordKindRule> = {}
  for (const { kind, severity } of DISCORD_ALERT_KINDS) {
    kinds[kind] = {
      send: severity !== 'low',
      ping: severity === 'high' || severity === 'critical' ? people.map((p) => p.id) : [],
    }
  }
  return { enabled: true, criticalRole: { enabled: false, roleId: '' }, people, kinds }
}

/** Fills gaps (new alert kinds added later) and drops references to people that no longer exist. */
export function normalizeDiscordConfig(raw: Partial<DiscordConfig> | null | undefined): DiscordConfig {
  const base = defaultDiscordConfig()
  const people = Array.isArray(raw?.people) ? raw.people : base.people
  const ids = new Set(people.map((p) => p.id))
  const kinds: Record<string, DiscordKindRule> = {}
  for (const kind of DISCORD_KIND_IDS) {
    const rule = raw?.kinds?.[kind] ?? base.kinds[kind]!
    const severity = ALERT_SEVERITIES.find((s) => s === rule.severity)
    kinds[kind] = { send: Boolean(rule.send), ping: rule.ping.filter((id) => ids.has(id)), ...(severity ? { severity } : {}) }
  }
  const role = raw?.criticalRole
  const criticalRole: DiscordCriticalRole = {
    enabled: Boolean(role?.enabled),
    roleId: typeof role?.roleId === 'string' ? role.roleId : '',
  }
  return { enabled: raw?.enabled ?? base.enabled, criticalRole, people, kinds }
}
