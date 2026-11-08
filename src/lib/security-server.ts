/**
 * Server-only helpers: e-mail sending, client IP, cookies, rate limiting,
 * the e-mail login-code session check and the audit log writer.
 * Only import this from server functions / middleware.
 */
import { createHash, randomBytes } from 'node:crypto'
import { admin } from '@netlify/identity'
import { getRequestHeader, setResponseHeader } from '@tanstack/react-start/server'
import { and, eq, gt, lt, sql } from 'drizzle-orm'

import { db } from '../../db'
import {
  auditLog,
  cooldowns,
  mfaSessions,
  searchAttempts,
  securityEvents,
} from '../../db/schema'
import {
  MANAGEMENT_COOLDOWN_SECONDS,
  ROLE_ADMIN,
  type AuditAction,
} from './registry'

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

/** Client IP as seen by Netlify; null when unknown (e.g. local dev). */
export function clientIp(): string | null {
  const direct = getRequestHeader('x-nf-client-connection-ip')
  if (direct) return direct
  const forwarded = getRequestHeader('x-forwarded-for')
  return forwarded?.split(',')[0]?.trim() || null
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
    await db.insert(auditLog).values(entry)
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
  setResponseHeader(
    'Set-Cookie',
    `${MFA_COOKIE}=${token}; Path=/; Max-Age=${SESSION_HOURS * 3600}; HttpOnly; Secure; SameSite=Lax`,
  )
}

// ---------------------------------------------------------------------------
// Security events, alerts and notifications
// ---------------------------------------------------------------------------

/** Best-effort security trail entry. */
export async function recordEvent(entry: {
  kind: string
  identity?: string | null
  ip?: string | null
  details?: string
  isAlert?: boolean
}) {
  try {
    await db.insert(securityEvents).values({
      kind: entry.kind,
      identity: entry.identity ?? null,
      ip: entry.ip ?? null,
      details: entry.details ?? null,
      isAlert: entry.isAlert ?? false,
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
    const perPage = 100
    for (let page = 1; page <= 20; page++) {
      const users = await admin.listUsers({ page, perPage })
      for (const user of users) {
        if (user.email && user.roles?.includes(ROLE_ADMIN)) emails.add(user.email)
      }
      if (users.length < perPage) break
    }
  } catch (error) {
    console.error('Nie udało się pobrać adresów administratorów', error)
    return cachedAdmins?.emails ?? []
  }
  cachedAdmins = { at: Date.now(), emails: [...emails] }
  return cachedAdmins.emails
}

function siteUrl(): string {
  return process.env.URL ?? ''
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
    await recordEvent({ ...opts, isAlert: true })
    await notifyAdmins('Alert bezpieczeństwa – Centralny Rejestr', opts.details)
  } catch (error) {
    console.error('Nie udało się zapisać alertu', error)
  }
}

/** Logs a successful panel login and raises an alert when the address was never seen for this account. */
export async function recordLogin(identity: string) {
  const ip = clientIp()
  try {
    const seenBefore = await countEvents({ kind: 'login', identity, minutes: 60 * 24 * 90 })
    const fromThisIp = ip
      ? await countEvents({ kind: 'login', identity, ip, minutes: 60 * 24 * 90 })
      : 1
    await recordEvent({ kind: 'login', identity, ip })
    if (seenBefore > 0 && fromThisIp === 0) {
      await raiseAlert({
        kind: 'new_ip',
        identity,
        details: `Konto ${identity} zalogowało się z nowego adresu IP (${ip}).`,
      })
    }
  } catch (error) {
    console.error('Nie udało się zapisać logowania', error)
  }
}

/** PESEL reveals are audited; many in a short time raise an alert. */
export async function logPeselView(opts: {
  actor: string
  actorRole: string
  target: string
  purpose: string
}) {
  await logEvent({
    actor: opts.actor,
    actorRole: opts.actorRole,
    action: 'pesel_view',
    target: opts.target,
    details: opts.purpose,
  })
  await recordEvent({ kind: 'pesel_view', identity: opts.actor, details: opts.target })
  const recent = await countEvents({ kind: 'pesel_view', identity: opts.actor, minutes: 10 })
  if (recent >= 15) {
    await raiseAlert({
      kind: 'pesel_mass_view',
      identity: opts.actor,
      details: `Konto ${opts.actor} odsłoniło ${recent} numerów PESEL w ciągu 10 minut.`,
      dedupeMinutes: 30,
    })
  }
}
