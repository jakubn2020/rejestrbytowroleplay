/**
 * Server-only helpers: e-mail sending, client IP, cookies, rate limiting,
 * the e-mail login-code session check and the audit log writer.
 * Only import this from server functions / middleware.
 */
import { createHash, randomBytes } from 'node:crypto'
import { getRequestHeader, setResponseHeader } from '@tanstack/react-start/server'
import { and, desc, eq, gt, lt, ne, sql } from 'drizzle-orm'

import { db } from '../../db'
import {
  auditLog,
  cooldowns,
  mfaSessions,
  searchAttempts,
  securityEvents,
  traffic,
  users,
} from '../../db/schema'
import {
  MANAGEMENT_COOLDOWN_SECONDS,
  ROLE_ADMIN,
  type AuditAction,
} from './registry'
import { SEC_DEFAULTS, SEC_KEYS, readNumberSetting } from './site-settings-server'

export const MFA_COOKIE = 'rejestr_mfa'

/** E-mail codes are only required when an e-mail provider (Resend) is configured. */
export function emailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Sends a plain-text e-mail through the Resend HTTP API. Returns false on any failure. */
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key) return false
  const from =
    process.env.EMAIL_FROM || 'Centralny Rejestr <onboarding@resend.dev>'
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
    })
    if (!response.ok) {
      console.error('Resend odrzucił wiadomość', response.status, await response.text())
      return false
    }
    return true
  } catch (error) {
    console.error('Nie udało się wysłać e-maila', error)
    return false
  }
}

/** Client IP as seen by Cloudflare; null when unknown (e.g. local dev). */
export function clientIp(): string | null {
  const direct = getRequestHeader('cf-connecting-ip')
  if (direct) return direct
  const forwarded = getRequestHeader('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() || null
}

/** Country code Cloudflare derived from the address ("T1" = Tor); null when unknown. */
export function clientCountry(): string | null {
  const value = getRequestHeader('cf-ipcountry')?.trim().toUpperCase()
  return value && /^[A-Z0-9]{2}$/.test(value) && value !== 'XX' ? value : null
}

export function readCookie(name: string): string | null {
  const header = getRequestHeader('cookie') ?? ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) {
      try {
        return decodeURIComponent(rest.join('='))
      } catch {
        return null
      }
    }
  }
  return null
}

/** At most this many numeric (PESEL/PWZ) lookups per IP per minute. */
const NUMERIC_LOOKUPS_PER_MINUTE = 15

/**
 * Records a numeric lookup and tells whether the caller is still within the limit.
 * Slows down anyone trying to guess PESEL / PWZ numbers.
 */
export async function lookupAllowed(): Promise<boolean> {
  const ip = clientIp()
  if (!ip) return true
  await db.insert(searchAttempts).values({ ip })
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(searchAttempts)
    .where(
      and(
        eq(searchAttempts.ip, ip),
        gt(searchAttempts.createdAt, sql`now() - interval '60 seconds'`),
      ),
    )
  if (Math.random() < 0.05) {
    await db
      .delete(searchAttempts)
      .where(lt(searchAttempts.createdAt, sql`now() - interval '1 hour'`))
  }
  const allowed = Number(row?.n ?? 0) <= NUMERIC_LOOKUPS_PER_MINUTE
  if (!allowed) {
    await raiseAlert({
      kind: 'lookup_limit',
      ip,
      details: `Adres ${ip} przekroczył limit zapytań o numery PESEL/PWZ (możliwe zgadywanie numerów)`,
      dedupeMinutes: 30,
    })
  }
  return allowed
}

/** True when this browser holds a valid panel session (see `createSession`) for `identity`. */
export async function mfaSatisfied(identity: string): Promise<boolean> {
  const token = readCookie(MFA_COOKIE)
  if (!token) return false
  const [row] = await db
    .select({ identity: mfaSessions.identity })
    .from(mfaSessions)
    .where(
      and(
        eq(mfaSessions.tokenHash, sha256(token)),
        eq(mfaSessions.identity, identity),
        gt(mfaSessions.expiresAt, sql`now()`),
      ),
    )
    .limit(1)
  return Boolean(row)
}

/** Best-effort audit trail: a logging failure must never undo or block the action itself. */
export async function logEvent(entry: {
  actor: string
  actorRole: string
  action: AuditAction
  target?: string
  details?: string
}) {
  try {
    let ip: string | null = null
    let userAgent: string | null = null
    try {
      ip = clientIp()
      userAgent = clientUserAgent()
    } catch {
      // outside a request there is no address
    }
    await db.insert(auditLog).values({ ...entry, ip, userAgent })
  } catch (error) {
    console.error('Nie udało się zapisać w dzienniku zdarzeń', error)
  }
}

// ---------------------------------------------------------------------------
// kierownictwo: one request per MANAGEMENT_COOLDOWN_SECONDS, claimed atomically
// ---------------------------------------------------------------------------

const COOLDOWN_INTERVAL = sql.raw(`interval '${MANAGEMENT_COOLDOWN_SECONDS} seconds'`)

/** Seconds a `kierownictwo` account still has to wait before submitting another request. */
export async function cooldownLeft(identity: string): Promise<number> {
  // Computed in SQL so both timestamps use the database clock and time zone.
  const [row] = await db
    .select({
      secondsAgo: sql<string>`extract(epoch from (now() - ${cooldowns.lastAt}))`,
    })
    .from(cooldowns)
    .where(eq(cooldowns.identity, identity))
    .limit(1)
  if (!row) return 0
  const left = MANAGEMENT_COOLDOWN_SECONDS - Number(row.secondsAgo)
  return left > 0 ? Math.ceil(left) : 0
}

/**
 * Starts the cooldown if (and only if) it is not running. One statement, so two
 * simultaneous requests from the same account cannot both succeed.
 */
export async function claimCooldown(identity: string): Promise<boolean> {
  const claimed = await db
    .insert(cooldowns)
    .values({ identity, lastAt: sql`now()` })
    .onConflictDoUpdate({
      target: cooldowns.identity,
      set: { lastAt: sql`now()` },
      setWhere: sql`${cooldowns.lastAt} <= now() - ${COOLDOWN_INTERVAL}`,
    })
    .returning({ identity: cooldowns.identity })
  return claimed.length > 0
}

export async function releaseCooldown(identity: string) {
  await db
    .update(cooldowns)
    .set({ lastAt: sql`now() - interval '1 day'` })
    .where(eq(cooldowns.identity, identity))
}

// ---------------------------------------------------------------------------
// Panel sessions (a cookie per browser; revocable from the panel)
// ---------------------------------------------------------------------------

export const SESSION_HOURS = 12

export function clientUserAgent(): string | null {
  return getRequestHeader('user-agent')?.slice(0, 300) || null
}

/** Starts a panel session for this browser: stores its hash and sets the HttpOnly cookie. */
export async function createSession(identity: string): Promise<void> {
  const token = randomBytes(32).toString('hex')
  await db.insert(mfaSessions).values({
    tokenHash: sha256(token),
    identity,
    expiresAt: sql`now() + ${sql.raw(`interval '${SESSION_HOURS} hours'`)}`,
    ip: clientIp(),
    userAgent: clientUserAgent(),
  })
  await db.delete(mfaSessions).where(lt(mfaSessions.expiresAt, sql`now()`))
  await trimSessions(identity)
  setResponseHeader(
    'Set-Cookie',
    `${MFA_COOKIE}=${token}; Path=/; Max-Age=${SESSION_HOURS * 3600}; HttpOnly; Secure; SameSite=Lax`,
  )
}

// ---------------------------------------------------------------------------
// Security events, alerts and notifications
// ---------------------------------------------------------------------------

export type Severity = 'low' | 'medium' | 'high' | 'critical'

/** Default severity of an alert kind. */
const KIND_SEVERITY: Record<string, Severity> = {
  test: 'low',
  new_ip: 'low',
  odd_hours: 'low',
  new_device: 'medium',
  login_failures_ip: 'medium',
  login_failures_account: 'medium',
  lookup_limit: 'medium',
  pesel_changed: 'medium',
  qr_mass_check: 'medium',
  mfa_lockout: 'high',
  pesel_mass_view: 'high',
  pesel_sequence: 'high',
  pesel_quota: 'high',
  new_country: 'high',
  tor_login: 'high',
  mass_status: 'high',
  pwz_guessing: 'high',
  two_countries: 'critical',
  mass_delete: 'critical',
  lockdown: 'critical',
}

export function severityOf(kind: string): Severity {
  return KIND_SEVERITY[kind] ?? 'medium'
}

/** Best-effort security trail entry. */
export async function recordEvent(entry: {
  kind: string
  identity?: string | null
  ip?: string | null
  details?: string
  isAlert?: boolean
  severity?: Severity
}) {
  try {
    let country: string | null = null
    try {
      country = clientCountry()
    } catch {
      // outside a request
    }
    await db.insert(securityEvents).values({
      kind: entry.kind,
      identity: entry.identity ?? null,
      ip: entry.ip ?? null,
      details: entry.details ?? null,
      isAlert: entry.isAlert ?? false,
      country,
      severity: entry.severity ?? severityOf(entry.kind),
    })
    if (Math.random() < 0.03) {
      await db
        .delete(securityEvents)
        .where(
          and(
            lt(securityEvents.createdAt, sql`now() - interval '90 days'`),
            eq(securityEvents.isAlert, false),
          ),
        )
    }
  } catch (error) {
    console.error('Nie udało się zapisać zdarzenia bezpieczeństwa', error)
  }
}

/** Keeps only the newest sessions of an account (the limit is a security setting; 0 = unlimited). */
export async function trimSessions(identity: string): Promise<void> {
  try {
    const limit = await readNumberSetting(SEC_KEYS.maxSessions, SEC_DEFAULTS.maxSessions)
    if (limit <= 0) return
    const rows = await db
      .select({ tokenHash: mfaSessions.tokenHash })
      .from(mfaSessions)
      .where(and(eq(mfaSessions.identity, identity), gt(mfaSessions.expiresAt, sql`now()`)))
      .orderBy(desc(mfaSessions.createdAt))
    for (const row of rows.slice(limit)) {
      await db.delete(mfaSessions).where(eq(mfaSessions.tokenHash, row.tokenHash))
    }
  } catch (error) {
    console.error('Nie udało się ograniczyć liczby sesji', error)
  }
}

/** Counts a request to the public search/verification (per minute and address) for the traffic chart. */
export async function trackTraffic(): Promise<void> {
  try {
    const ip = clientIp()
    if (!ip) return
    const minute = new Date().toISOString().slice(0, 16)
    await db
      .insert(traffic)
      .values({ id: `${minute}|${ip}`, minute, ip, hits: 1 })
      .onConflictDoUpdate({ target: traffic.id, set: { hits: sql`${traffic.hits} + 1` } })
    if (Math.random() < 0.02) {
      const cutoff = new Date(Date.now() - 48 * 3_600_000).toISOString().slice(0, 16)
      await db.delete(traffic).where(lt(traffic.minute, cutoff))
    }
  } catch (error) {
    console.error('Nie udało się zapisać ruchu', error)
  }
}

/** Number of events of one kind for an address or account in the last `minutes` minutes. */
export async function countEvents(opts: {
  kind: string
  ip?: string | null
  identity?: string | null
  minutes: number
}): Promise<number> {
  const conditions = [
    eq(securityEvents.kind, opts.kind),
    gt(
      securityEvents.createdAt,
      sql`now() - ${sql.raw(`interval '${Math.floor(opts.minutes)} minutes'`)}`,
    ),
  ]
  if (opts.ip) conditions.push(eq(securityEvents.ip, opts.ip))
  if (opts.identity) conditions.push(eq(securityEvents.identity, opts.identity))
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(securityEvents)
    .where(and(...conditions))
  return Number(row?.n ?? 0)
}

let cachedAdmins: { at: number; emails: string[] } | null = null

/** E-mail addresses of all admin accounts (cached for a few minutes). */
async function adminEmails(): Promise<string[]> {
  if (cachedAdmins && Date.now() - cachedAdmins.at < 5 * 60_000) {
    return cachedAdmins.emails
  }
  const emails = new Set<string>()
  try {
    const rows = await db.select({ email: users.email, roles: users.roles }).from(users)
    for (const row of rows) {
      if (row.roles.includes(ROLE_ADMIN)) emails.add(row.email)
    }
  } catch (error) {
    console.error('Nie udało się pobrać adresów administratorów', error)
    return cachedAdmins?.emails ?? []
  }
  cachedAdmins = { at: Date.now(), emails: [...emails] }
  return cachedAdmins.emails
}

function siteUrl(): string {
  return process.env.SITE_URL ?? ''
}

/** E-mails every admin (only when e-mail sending is configured). Never throws. */
export async function notifyAdmins(subject: string, text: string) {
  if (!emailEnabled()) return
  try {
    const link = siteUrl()
    const body = link ? `${text}\n\nPanel: ${link}/admin` : text
    for (const email of await adminEmails()) {
      await sendEmail(email, subject, body)
    }
  } catch (error) {
    console.error('Nie udało się powiadomić administratorów', error)
  }
}

/** E-mails one staff member (only when e-mail sending is configured and `to` looks like an address). */
export async function notifyUser(to: string, subject: string, text: string) {
  if (!emailEnabled() || !to.includes('@')) return
  try {
    const link = siteUrl()
    await sendEmail(to, subject, link ? `${text}\n\nPanel: ${link}/admin` : text)
  } catch (error) {
    console.error('Nie udało się wysłać powiadomienia', error)
  }
}

/**
 * Records an alert (shown to admins in the panel and e-mailed when possible).
 * With `dedupeMinutes` an alert of the same kind for the same address/account is not repeated.
 */
export async function raiseAlert(opts: {
  kind: string
  identity?: string | null
  ip?: string | null
  details: string
  dedupeMinutes?: number
  severity?: Severity
}) {
  try {
    if (opts.dedupeMinutes) {
      const duplicate = await db
        .select({ id: securityEvents.id })
        .from(securityEvents)
        .where(
          and(
            eq(securityEvents.kind, opts.kind),
            eq(securityEvents.isAlert, true),
            opts.ip ? eq(securityEvents.ip, opts.ip) : sql`true`,
            opts.identity ? eq(securityEvents.identity, opts.identity) : sql`true`,
            gt(
              securityEvents.createdAt,
              sql`now() - ${sql.raw(`interval '${Math.floor(opts.dedupeMinutes)} minutes'`)}`,
            ),
          ),
        )
        .limit(1)
      if (duplicate.length > 0) return
    }
    const severity = opts.severity ?? severityOf(opts.kind)
    await recordEvent({ ...opts, isAlert: true, severity })
    await notifyAdmins(
      severity === 'critical'
        ? '[KRYTYCZNY] Alert bezpieczeństwa – Centralny Rejestr'
        : 'Alert bezpieczeństwa – Centralny Rejestr',
      opts.details,
    )
  } catch (error) {
    console.error('Nie udało się zapisać alertu', error)
  }
}

/** Short, readable description of a browser from its user-agent (e.g. "Chrome, Windows"). */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'nieznane urządzenie'
  const ua = userAgent
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'przeglądarka'
  const system = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad|iOS/.test(ua)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'inny system'
  return `${browser}, ${system}`
}

function warsawHour(date: Date): number {
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    hour: '2-digit',
    hour12: false,
  }).format(date)
  return Number.parseInt(text, 10) % 24
}

/**
 * Logs a successful panel login and looks for anything unusual: a browser, address or country
 * never used before, Tor, two countries within hours, or a time of day the account never used.
 */
export async function recordLogin(identity: string) {
  const ip = clientIp()
  const agent = clientUserAgent()
  const country = clientCountry()
  const device = `device:${sha256(describeDevice(agent)).slice(0, 16)}`
  try {
    const seenBefore = await countEvents({ kind: 'login', identity, minutes: 60 * 24 * 90 })
    const [knownDevice] = await db
      .select({ id: securityEvents.id })
      .from(securityEvents)
      .where(
        and(
          eq(securityEvents.kind, 'login'),
          eq(securityEvents.identity, identity),
          eq(securityEvents.details, device),
        ),
      )
      .limit(1)
    const fromThisIp = ip
      ? await countEvents({ kind: 'login', identity, ip, minutes: 60 * 24 * 90 })
      : 1
    let knownCountry = true
    let otherCountryRecently = false
    if (country) {
      const [seen] = await db
        .select({ id: securityEvents.id })
        .from(securityEvents)
        .where(
          and(
            eq(securityEvents.kind, 'login'),
            eq(securityEvents.identity, identity),
            eq(securityEvents.country, country),
          ),
        )
        .limit(1)
      knownCountry = Boolean(seen)
      const [recent] = await db
        .select({ id: securityEvents.id })
        .from(securityEvents)
        .where(
          and(
            eq(securityEvents.kind, 'login'),
            eq(securityEvents.identity, identity),
            ne(securityEvents.country, country),
            gt(securityEvents.createdAt, sql`now() - interval '12 hours'`),
          ),
        )
        .limit(1)
      otherCountryRecently = Boolean(recent)
    }
    const history = await db
      .select({ at: securityEvents.createdAt })
      .from(securityEvents)
      .where(
        and(
          eq(securityEvents.kind, 'login'),
          eq(securityEvents.identity, identity),
          gt(securityEvents.createdAt, sql`now() - interval '90 days'`),
        ),
      )
      .orderBy(desc(securityEvents.createdAt))
      .limit(300)
    await recordEvent({ kind: 'login', identity, ip, details: device })

    if (country === 'T1') {
      await raiseAlert({
        kind: 'tor_login',
        identity,
        ip,
        details: `Konto ${identity} zalogowało się przez sieć Tor.`,
        dedupeMinutes: 60,
      })
    }
    if (seenBefore === 0) return
    const label = describeDevice(agent)
    if (!knownDevice) {
      await raiseAlert({
        kind: 'new_device',
        identity,
        details: `Konto ${identity} zalogowało się z nowego urządzenia: ${label} (adres IP ${ip ?? 'nieznany'}).`,
      })
      await notifyUser(
        identity,
        'Logowanie z nowego urządzenia – Centralny Rejestr',
        `Twoje konto zalogowało się z nowego urządzenia: ${label}. Jeśli to nie Ty, zmień hasło i wyloguj się ze wszystkich urządzeń.`,
      )
    } else if (ip && fromThisIp === 0) {
      await raiseAlert({
        kind: 'new_ip',
        identity,
        details: `Konto ${identity} zalogowało się z nowego adresu IP (${ip}).`,
      })
    }
    if (country && country !== 'T1' && !knownCountry) {
      await raiseAlert({
        kind: 'new_country',
        identity,
        details: `Konto ${identity} zalogowało się z nowego kraju: ${country} (wcześniej nie używanego).`,
      })
    }
    if (country && otherCountryRecently) {
      await raiseAlert({
        kind: 'two_countries',
        identity,
        details: `Konto ${identity} zalogowało się z dwóch różnych krajów w ciągu 12 godzin (teraz: ${country}).`,
        dedupeMinutes: 120,
      })
    }
    if (history.length >= 5) {
      const hours = new Set(history.map((row) => warsawHour(row.at)))
      const now = warsawHour(new Date())
      const near = [(now + 23) % 24, now, (now + 1) % 24].some((h) => hours.has(h))
      if (!near) {
        await raiseAlert({
          kind: 'odd_hours',
          identity,
          details: `Konto ${identity} zalogowało się o nietypowej porze (${now}:00); zwykle loguje się w innych godzinach.`,
          dedupeMinutes: 360,
        })
      }
    }
  } catch (error) {
    console.error('Nie udało się zapisać logowania', error)
  }
}

/** Has this account used up its daily PESEL reveals (a security setting; 0 = no limit)? */
export async function peselQuotaExceeded(identity: string): Promise<boolean> {
  try {
    const limit = await readNumberSetting(SEC_KEYS.peselDailyLimit, SEC_DEFAULTS.peselDailyLimit)
    if (limit <= 0) return false
    const used = await countEvents({ kind: 'pesel_view', identity, minutes: 60 * 24 })
    if (used >= limit) {
      await raiseAlert({
        kind: 'pesel_quota',
        identity,
        details: `Konto ${identity} wyczerpało dzienny limit odsłonięć PESEL (${limit}).`,
        dedupeMinutes: 60 * 12,
      })
      return true
    }
    return false
  } catch {
    return false
  }
}

export const PESEL_QUOTA_MESSAGE =
  'Wyczerpano dzienny limit odsłonięć numerów PESEL dla tego konta. Spróbuj jutro albo poproś właściciela.'

/** PESEL reveals are audited; many in a short time, or one entry after another, raise an alert. */
export async function logPeselView(opts: {
  actor: string
  actorRole: string
  target: string
  purpose: string
  entryId?: number
}) {
  await logEvent({
    actor: opts.actor,
    actorRole: opts.actorRole,
    action: 'pesel_view',
    target: opts.target,
    details: opts.purpose,
  })
  await recordEvent({
    kind: 'pesel_view',
    identity: opts.actor,
    details: opts.entryId === undefined ? opts.target : `${opts.target}|id:${opts.entryId}`,
  })
  const threshold = await readNumberSetting(SEC_KEYS.peselThreshold, SEC_DEFAULTS.peselThreshold)
  const recent = await countEvents({ kind: 'pesel_view', identity: opts.actor, minutes: 10 })
  if (recent >= threshold) {
    await raiseAlert({
      kind: 'pesel_mass_view',
      identity: opts.actor,
      details: `Konto ${opts.actor} odsłoniło ${recent} numerów PESEL w ciągu 10 minut.`,
      dedupeMinutes: 30,
    })
  }
  // Going through entries one after another (by id) looks like scanning the whole registry.
  try {
    const rows = await db
      .select({ details: securityEvents.details })
      .from(securityEvents)
      .where(
        and(
          eq(securityEvents.kind, 'pesel_view'),
          eq(securityEvents.identity, opts.actor),
          gt(securityEvents.createdAt, sql`now() - interval '10 minutes'`),
        ),
      )
      .orderBy(desc(securityEvents.createdAt))
      .limit(8)
    const ids = rows
      .map((row) => /\|id:(\d+)$/.exec(row.details ?? '')?.[1])
      .filter((value): value is string => value !== undefined)
      .map(Number)
    if (rows.length === 8 && ids.length === 8) {
      const diffs = ids.slice(1).map((id, i) => id - ids[i])
      const ascending = diffs.every((d) => d >= 1 && d <= 3)
      const descending = diffs.every((d) => d <= -1 && d >= -3)
      if (ascending || descending) {
        await raiseAlert({
          kind: 'pesel_sequence',
          identity: opts.actor,
          details: `Konto ${opts.actor} odsłania numery PESEL kolejnych wpisów jeden po drugim (możliwe skanowanie rejestru).`,
          dedupeMinutes: 60,
        })
      }
    }
  } catch (error) {
    console.error('Nie udało się sprawdzić kolejności odsłonięć', error)
  }
}
