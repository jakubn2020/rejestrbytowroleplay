/** Server-only: site-wide switches stored in the `settings` table (e.g. the emergency "registry closed" mode). */
import { eq, inArray } from 'drizzle-orm'

import { db } from '../../db'
import { settings } from '../../db/schema'

export const MAINTENANCE_KEY = 'maintenance'
export const MAINTENANCE_MESSAGE_KEY = 'maintenance_message'

export const MAINTENANCE_DEFAULT_MESSAGE =
  'Rejestr jest chwilowo zamknięty z powodu problemu technicznego. Spróbuj ponownie za jakiś czas.'

export type Maintenance = { closed: boolean; message: string }

/** Is the public registry closed? A failed read counts as open so a database hiccup never locks everyone out. */
export async function readMaintenance(): Promise<Maintenance> {
  try {
    const rows = await db
      .select()
      .from(settings)
      .where(inArray(settings.key, [MAINTENANCE_KEY, MAINTENANCE_MESSAGE_KEY]))
    const closed = rows.find((r) => r.key === MAINTENANCE_KEY)?.value === '1'
    const message =
      rows.find((r) => r.key === MAINTENANCE_MESSAGE_KEY)?.value?.trim() ||
      MAINTENANCE_DEFAULT_MESSAGE
    return { closed, message }
  } catch (error) {
    console.error('Nie udało się odczytać trybu awaryjnego', error)
    return { closed: false, message: MAINTENANCE_DEFAULT_MESSAGE }
  }
}

export async function writeSetting(key: string, value: string) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
}

export async function writeMaintenance(closed: boolean, message: string) {
  await writeSetting(MAINTENANCE_KEY, closed ? '1' : '0')
  await writeSetting(MAINTENANCE_MESSAGE_KEY, message)
}

export async function clearSetting(key: string) {
  await db.delete(settings).where(eq(settings.key, key))
}

export async function readSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1)
  return row?.value ?? null
}

export async function readNumberSetting(key: string, fallback: number): Promise<number> {
  try {
    const value = await readSetting(key)
    const n = value === null ? NaN : Number(value)
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

/** Security policy knobs (all editable by the owner in the security centre). */
export const SEC_KEYS = {
  peselThreshold: 'sec_pesel_threshold',
  peselDailyLimit: 'sec_pesel_daily_limit',
  maxSessions: 'sec_max_sessions',
  unusedDays: 'sec_unused_days',
  whitelist: 'sec_whitelist',
  lockdown: 'sec_lockdown',
} as const

export const SEC_DEFAULTS = {
  peselThreshold: 15,
  peselDailyLimit: 0,
  maxSessions: 5,
  unusedDays: 60,
} as const

export type SecuritySettings = {
  /** PESEL reveals within 10 minutes that raise an alert. */
  peselThreshold: number
  /** PESEL reveals per account per day (0 = no limit). */
  peselDailyLimit: number
  /** Simultaneous sessions per account (0 = no limit). */
  maxSessions: number
  /** Days of inactivity after which an account is blocked (0 = never). */
  unusedDays: number
  whitelist: boolean
  lockdown: boolean
}

export async function readSecuritySettings(): Promise<SecuritySettings> {
  return {
    peselThreshold: await readNumberSetting(SEC_KEYS.peselThreshold, SEC_DEFAULTS.peselThreshold),
    peselDailyLimit: await readNumberSetting(SEC_KEYS.peselDailyLimit, SEC_DEFAULTS.peselDailyLimit),
    maxSessions: await readNumberSetting(SEC_KEYS.maxSessions, SEC_DEFAULTS.maxSessions),
    unusedDays: await readNumberSetting(SEC_KEYS.unusedDays, SEC_DEFAULTS.unusedDays),
    whitelist: (await readNumberSetting(SEC_KEYS.whitelist, 0)) === 1,
    lockdown: (await readNumberSetting(SEC_KEYS.lockdown, 0)) === 1,
  }
}

/** Owner's feature switches and notices (stored in `settings`). */
export const FLAG_KEYS = {
  reports: 'flag_reports',
  requests: 'flag_requests',
  search: 'flag_search',
  verify: 'flag_verify',
  exams: 'flag_exams',
  noticePublic: 'notice_public',
  noticePublicLevel: 'notice_public_level',
  noticeStaff: 'notice_staff',
} as const

/** A switch is on unless the owner stored '0'; a failed read never turns a feature off. */
export async function readFlag(key: string): Promise<boolean> {
  try {
    return (await readSetting(key)) !== '0'
  } catch {
    return true
  }
}
