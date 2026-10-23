/**
 * Server-only helpers: e-mail sending, client IP, cookies, rate limiting,
 * the e-mail login-code session check and the audit log writer.
 * Only import this from server functions / middleware.
 */
import { createHash } from 'node:crypto'
import { getRequestHeader } from '@tanstack/react-start/server'
import { and, eq, gt, lt, sql } from 'drizzle-orm'

import { db } from '../../db'
import { auditLog, cooldowns, mfaSessions, searchAttempts } from '../../db/schema'
import { MANAGEMENT_COOLDOWN_SECONDS, type AuditAction } from './registry'

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
    if (key === name) return decodeURIComponent(rest.join('='))
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
  return Number(row?.n ?? 0) <= NUMERIC_LOOKUPS_PER_MINUTE
}

/** True when e-mail codes are off, or this browser holds a valid verified session for `identity`. */
export async function mfaSatisfied(identity: string): Promise<boolean> {
  if (!emailEnabled()) return true
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
