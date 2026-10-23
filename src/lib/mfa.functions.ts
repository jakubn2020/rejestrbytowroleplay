/**
 * E-mail one-time code as a second login step for admin / kierownictwo.
 * Only active when RESEND_API_KEY is configured (see README); otherwise
 * the panel behaves exactly as before.
 */
import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { getUser } from '@netlify/identity'
import { and, desc, eq, gt, lt, sql } from 'drizzle-orm'
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

import { db } from '../../db'
import { loginCodes, mfaSessions } from '../../db/schema'
import { ROLE_ADMIN, ROLE_MANAGEMENT } from './registry'
import {
  MFA_COOKIE,
  emailEnabled,
  logEvent,
  mfaSatisfied,
  readCookie,
  sendEmail,
  sha256,
} from './security-server'

const CODE_MINUTES = 10
const SESSION_HOURS = 12
const MAX_ATTEMPTS = 5

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
    if (!staff || !emailEnabled()) return { required: false, verified: true }
    return { required: true, verified: await mfaSatisfied(staff.identity) }
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
    const token = randomBytes(32).toString('hex')
    await db.insert(mfaSessions).values({
      tokenHash: sha256(token),
      identity: staff.identity,
      expiresAt: sql`now() + interval '12 hours'`,
    })
    await db
      .delete(mfaSessions)
      .where(lt(mfaSessions.expiresAt, sql`now()`))
    setResponseHeader(
      'Set-Cookie',
      `${MFA_COOKIE}=${token}; Path=/; Max-Age=${SESSION_HOURS * 3600}; HttpOnly; Secure; SameSite=Lax`,
    )
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
