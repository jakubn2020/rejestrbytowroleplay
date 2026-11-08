/**
 * Panel sessions for admin / kierownictwo: an e-mail one-time code as a second login step
 * (only when RESEND_API_KEY is configured, see README), and a revocable session per browser.
 */
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { getUser } from '@netlify/identity'
import { and, desc, eq, gt, like, sql } from 'drizzle-orm'
import { randomInt, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

import { db } from '../../db'
import { loginCodes, mfaSessions } from '../../db/schema'
import { requireStaff } from './auth-server'
import { ROLE_ADMIN, ROLE_MANAGEMENT } from './registry'
import {
  MFA_COOKIE,
  countEvents,
  createSession,
  emailEnabled,
  logEvent,
  mfaSatisfied,
  raiseAlert,
  readCookie,
  recordEvent,
  recordLogin,
  sendEmail,
  sha256,
} from './security-server'

const CODE_MINUTES = 10
const MAX_ATTEMPTS = 5
/** After this many exhausted codes in 15 minutes, no new code is sent for a while. */
const MAX_LOCKOUTS = 3

/** The signed-in staff member (admin or kierownictwo), or null. Does not check the e-mail step. */
async function currentStaff() {
  const user = await getUser()
  const roles = user?.roles ?? []
  const isAdmin = roles.includes(ROLE_ADMIN)
  if (!user || (!isAdmin && !roles.includes(ROLE_MANAGEMENT))) return null
  return {
    identity: (user.email ?? user.id).toLowerCase(),
    email: user.email ?? null,
    role: isAdmin ? ROLE_ADMIN : ROLE_MANAGEMENT,
  }
}

export type MfaResult = { ok: true } | { ok: false; error: string }

/** Tells the login page whether an e-mail code is needed and already confirmed in this browser. */
export const getMfaStatus = createServerFn({ method: 'GET' }).handler(
  async () => {
    const staff = await currentStaff()
    if (!staff) return { required: false, verified: true }
    return {
      required: emailEnabled(),
      verified: await mfaSatisfied(staff.identity),
    }
  },
)

/** Without e-mail codes: starts the panel session right after the password login. */
export const startPlainSession = createServerFn({ method: 'POST' }).handler(
  async (): Promise<MfaResult> => {
    const staff = await currentStaff()
    if (!staff) return { ok: false, error: 'Brak uprawnień.' }
    if (emailEnabled()) {
      return { ok: false, error: 'Wymagane potwierdzenie kodem z e-maila.' }
    }
    await createSession(staff.identity)
    await recordLogin(staff.identity)
    await logEvent({
      actor: staff.identity,
      actorRole: staff.role,
      action: 'login',
    })
    return { ok: true }
  },
)

/** Sends a fresh 6-digit code to the account's e-mail address (at most once a minute). */
export const sendLoginCode = createServerFn({ method: 'POST' }).handler(
  async (): Promise<MfaResult> => {
    const staff = await currentStaff()
    if (!staff || !staff.email) return { ok: false, error: 'Brak uprawnień.' }
    if (!emailEnabled()) {
      return { ok: false, error: 'Wysyłanie e-maili nie jest skonfigurowane.' }
    }

    const lockouts = await countEvents({
      kind: 'mfa_lockout',
      identity: staff.identity,
      minutes: 15,
    })
    if (lockouts >= MAX_LOCKOUTS) {
      return {
        ok: false,
        error: 'Konto jest czasowo zablokowane po zbyt wielu błędnych kodach. Spróbuj za 15 minut.',
      }
    }

    const [recent] = await db
      .select({ id: loginCodes.id })
      .from(loginCodes)
      .where(
        and(
          eq(loginCodes.identity, staff.identity),
          gt(loginCodes.createdAt, sql`now() - interval '60 seconds'`),
        ),
      )
      .limit(1)
    if (recent) {
      return {
        ok: false,
        error: 'Kod został już wysłany. Poczekaj minutę przed ponowną prośbą.',
      }
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    await db.delete(loginCodes).where(eq(loginCodes.identity, staff.identity))
    await db.insert(loginCodes).values({
      identity: staff.identity,
      codeHash: sha256(`${staff.identity}:${code}`),
      expiresAt: sql`now() + interval '10 minutes'`,
    })

    const sent = await sendEmail(
      staff.email,
      'Kod logowania – Centralny Rejestr',
      `Twój kod logowania: ${code}\n\nKod jest ważny ${CODE_MINUTES} minut. Jeśli to nie Ty próbujesz się zalogować, zignoruj tę wiadomość i zmień hasło.`,
    )
    if (!sent) {
      await db.delete(loginCodes).where(eq(loginCodes.identity, staff.identity))
      return {
        ok: false,
        error: 'Nie udało się wysłać wiadomości z kodem. Spróbuj ponownie za chwilę.',
      }
    }
    return { ok: true }
  },
)

/** Checks the code; on success sets an HttpOnly cookie that unlocks the protected server functions. */
export const verifyLoginCode = createServerFn({ method: 'POST' })
  .validator(
    z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Kod składa się z 6 cyfr') }),
  )
  .handler(async ({ data }): Promise<MfaResult> => {
    const staff = await currentStaff()
    if (!staff) return { ok: false, error: 'Brak uprawnień.' }

    const [row] = await db
      .select()
      .from(loginCodes)
      .where(
        and(
          eq(loginCodes.identity, staff.identity),
          gt(loginCodes.expiresAt, sql`now()`),
        ),
      )
      .orderBy(desc(loginCodes.id))
      .limit(1)
    if (!row) {
      return { ok: false, error: 'Kod wygasł lub nie został wysłany. Wyślij nowy kod.' }
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      await db.delete(loginCodes).where(eq(loginCodes.identity, staff.identity))
      await recordEvent({ kind: 'mfa_lockout', identity: staff.identity })
      await raiseAlert({
        kind: 'mfa_lockout',
        identity: staff.identity,
        details: `Konto ${staff.identity}: ${MAX_ATTEMPTS} błędnych kodów logowania z e-maila (możliwe zgadywanie kodu).`,
        dedupeMinutes: 15,
      })
      return { ok: false, error: 'Zbyt wiele błędnych prób. Wyślij nowy kod.' }
    }

    const expected = Buffer.from(row.codeHash, 'hex')
    const given = Buffer.from(sha256(`${staff.identity}:${data.code}`), 'hex')
    const match =
      expected.length === given.length && timingSafeEqual(expected, given)
    if (!match) {
      await db
        .update(loginCodes)
        .set({ attempts: sql`${loginCodes.attempts} + 1` })
        .where(eq(loginCodes.id, row.id))
      return { ok: false, error: 'Nieprawidłowy kod.' }
    }

    await db.delete(loginCodes).where(eq(loginCodes.identity, staff.identity))
    await createSession(staff.identity)
    await recordLogin(staff.identity)
    await logEvent({
      actor: staff.identity,
      actorRole: staff.role,
      action: 'login',
      details: 'Potwierdzono kodem z e-maila',
    })
    return { ok: true }
  })

/** Ends the e-mail-verified session of this browser (called on logout). */
export const endMfaSession = createServerFn({ method: 'POST' }).handler(
  async () => {
    const token = readCookie(MFA_COOKIE)
    if (token) {
      await db
        .delete(mfaSessions)
        .where(eq(mfaSessions.tokenHash, sha256(token)))
    }
    setResponseHeader(
      'Set-Cookie',
      `${MFA_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    )
    return { ok: true }
  },
)

export type SessionRow = {
  id: string
  createdAt: string
  expiresAt: string
  ip: string | null
  userAgent: string | null
  current: boolean
}

/** The caller's own panel sessions (browsers that are currently signed in). */
export const listMySessions = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(async ({ context }): Promise<SessionRow[]> => {
    const token = readCookie(MFA_COOKIE)
    const currentHash = token ? sha256(token) : null
    const rows = await db
      .select()
      .from(mfaSessions)
      .where(
        and(
          eq(mfaSessions.identity, context.identity),
          gt(mfaSessions.expiresAt, sql`now()`),
        ),
      )
      .orderBy(desc(mfaSessions.createdAt))
    return rows.map((row) => ({
      id: row.tokenHash.slice(0, 16),
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      ip: row.ip,
      userAgent: row.userAgent,
      current: row.tokenHash === currentHash,
    }))
  })

/** Signs one of the caller's sessions out (it loses access to the panel at once). */
export const revokeSession = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator(z.object({ id: z.string().regex(/^[0-9a-f]{16}$/) }))
  .handler(async ({ data, context }) => {
    await db
      .delete(mfaSessions)
      .where(
        and(
          eq(mfaSessions.identity, context.identity),
          like(mfaSessions.tokenHash, `${data.id}%`),
        ),
      )
    return { ok: true }
  })

/** Signs the caller out of the panel on every device, including this one. */
export const revokeAllSessions = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .handler(async ({ context }) => {
    await db.delete(mfaSessions).where(eq(mfaSessions.identity, context.identity))
    await logEvent({
      actor: context.identity,
      actorRole: context.isAdmin ? ROLE_ADMIN : ROLE_MANAGEMENT,
      action: 'sessions_revoked',
    })
    setResponseHeader(
      'Set-Cookie',
      `${MFA_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    )
    return { ok: true }
  })
