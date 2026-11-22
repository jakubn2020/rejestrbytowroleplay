import { randomBytes } from 'node:crypto'
import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, ne, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import { authSessions, mfaSessions, passwordResets, securityEvents, users } from '../../db/schema'
import { requireSuperAdmin } from './auth-server'
import { hashPassword } from './password'
import { ROLE_ADMIN } from './registry'
import { AUTH_COOKIE, superAdminEmail } from './session-server'
import {
  MFA_COOKIE,
  logEvent,
  notifyAdmins,
  notifyUser,
  readCookie,
  sha256,
} from './security-server'

const emailInput = z.object({ email: z.string().trim().toLowerCase().min(1).max(200) })

export type AccountRow = {
  id: string
  email: string
  roles: string[]
  locked: boolean
  lockedReason: string | null
  frozenUntil: string | null
  mustChangePassword: boolean
  weakPassword: boolean
  lastLoginAt: string | null
  isOwner: boolean
}

/** Owner only: every staff account with its security state. */
export const listAccounts = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .handler(async (): Promise<AccountRow[]> => {
    const rows = await db.select().from(users).orderBy(users.email)
    const owner = superAdminEmail()
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      roles: row.roles,
      locked: row.locked,
      lockedReason: row.lockedReason,
      frozenUntil:
        row.frozenUntil && row.frozenUntil.getTime() > Date.now()
          ? row.frozenUntil.toISOString()
          : null,
      mustChangePassword: row.mustChangePassword,
      weakPassword: row.weakPassword,
      lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
      isOwner: row.email.toLowerCase() === owner,
    }))
  })

async function targetOf(email: string) {
  if (email === superAdminEmail()) throw new Error('Konta właściciela nie można zmieniać tym narzędziem.')
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (!row) throw new Error('Nie znaleziono konta.')
  return row
}

async function endAllSessions(userId: string, email: string) {
  await db.delete(authSessions).where(eq(authSessions.userId, userId))
  await db.delete(mfaSessions).where(eq(mfaSessions.identity, email))
}

/** Owner only: blocks or unblocks an account (a blocked account is signed out at once). */
export const setAccountLock = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(emailInput.extend({ locked: z.boolean(), reason: z.string().trim().max(200).optional() }))
  .handler(async ({ data, context }) => {
    const target = await targetOf(data.email)
    await db
      .update(users)
      .set({
        locked: data.locked,
        lockedReason: data.locked ? data.reason || 'Zablokowane przez właściciela' : null,
        // Unblocking also restarts the inactivity clock so the account is not locked again at once.
        ...(data.locked ? {} : { lastLoginAt: sql`now()`, frozenUntil: null }),
      })
      .where(eq(users.id, target.id))
    if (data.locked) await endAllSessions(target.id, target.email)
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'account_lock',
      target: target.email,
      details: data.locked ? data.reason || 'Zablokowano konto' : 'Odblokowano konto',
    })
    return { ok: true as const }
  })

/** Owner only: freezes an account for 1–720 hours (0 lifts the freeze). */
export const freezeAccount = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(emailInput.extend({ hours: z.number().int().min(0).max(720) }))
  .handler(async ({ data, context }) => {
    const target = await targetOf(data.email)
    const until = data.hours > 0 ? new Date(Date.now() + data.hours * 3_600_000) : null
    await db.update(users).set({ frozenUntil: until }).where(eq(users.id, target.id))
    if (until) await endAllSessions(target.id, target.email)
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'account_lock',
      target: target.email,
      details: until ? `Zamrożono konto na ${data.hours} godz.` : 'Zdjęto zamrożenie konta',
    })
    return { ok: true as const }
  })

/** Owner only: the account must set a new password at its next sign-in. */
export const forcePasswordChange = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(emailInput)
  .handler(async ({ data, context }) => {
    const target = await targetOf(data.email)
    await db.update(users).set({ mustChangePassword: true }).where(eq(users.id, target.id))
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'account_lock',
      target: target.email,
      details: 'Wymuszono zmianę hasła przy następnym logowaniu',
    })
    return { ok: true as const }
  })

/** Owner only: a one-time link (valid for an hour) with which the account sets a new password. */
export const createResetLink = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(emailInput)
  .handler(async ({ data, context }) => {
    const target = await targetOf(data.email)
    const token = randomBytes(32).toString('hex')
    await db.insert(passwordResets).values({
      tokenHash: sha256(token),
      userId: target.id,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    })
    await db.delete(passwordResets).where(sql`${passwordResets.expiresAt} < now() - interval '1 day'`)
    const base = (process.env.SITE_URL ?? '').replace(/\/$/, '')
    const path = `/reset-hasla?token=${token}`
    await notifyUser(
      target.email,
      'Ustaw nowe hasło – Centralny Rejestr',
      `Właściciel wygenerował dla Ciebie jednorazowy link do ustawienia hasła (ważny godzinę): ${base}${path}`,
    )
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'account_lock',
      target: target.email,
      details: 'Wygenerowano jednorazowy link do resetu hasła',
    })
    return { path, expiresInMinutes: 60 }
  })

/**
 * Owner only: sets a freshly generated password and returns it once.
 * Passwords are stored only as irreversible hashes, so an existing password can never be shown;
 * this is the way to get a password you can hand over. The account must change it at once.
 */
export const setTemporaryPassword = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(emailInput)
  .handler(async ({ data, context }) => {
    const target = await targetOf(data.email)
    const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const bytes = randomBytes(16)
    const password = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('') + '#7'
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(password), mustChangePassword: true })
      .where(eq(users.id, target.id))
    await endAllSessions(target.id, target.email)
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'temp_password',
      target: target.email,
      details: 'Ustawiono hasło tymczasowe (konto musi je zmienić po zalogowaniu)',
    })
    return { password }
  })

export type HistoryRow = {
  id: number
  createdAt: string
  kind: string
  ip: string | null
  country: string | null
  details: string | null
}

/** Owner only: the latest logins and failed attempts of one account. */
export const accountHistory = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .validator(emailInput)
  .handler(async ({ data }): Promise<HistoryRow[]> => {
    const rows = await db
      .select()
      .from(securityEvents)
      .where(
        and(
          eq(securityEvents.identity, data.email),
          or(
            eq(securityEvents.kind, 'login'),
            eq(securityEvents.kind, 'login_failed'),
            eq(securityEvents.isAlert, true),
          ),
        ),
      )
      .orderBy(desc(securityEvents.createdAt))
      .limit(40)
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      kind: row.kind,
      ip: row.ip,
      country: row.country,
      details: row.details && !row.details.startsWith('device:') ? row.details : null,
    }))
  })

/** Owner only: forces every other account to choose a new password and signs everybody out. */
export const invalidateAllPasswords = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .handler(async ({ context }) => {
    const owner = superAdminEmail()
    await db.update(users).set({ mustChangePassword: true }).where(ne(users.email, owner))
    const keepAuth = readCookie(AUTH_COOKIE)
    const keepMfa = readCookie(MFA_COOKIE)
    await db
      .delete(mfaSessions)
      .where(keepMfa ? ne(mfaSessions.tokenHash, sha256(keepMfa)) : undefined)
    await db
      .delete(authSessions)
      .where(keepAuth ? ne(authSessions.tokenHash, sha256(keepAuth)) : undefined)
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'account_lock',
      target: 'Wszystkie konta',
      details: 'Unieważniono hasła: każde konto musi ustawić nowe po zalogowaniu',
    })
    await notifyAdmins(
      'Unieważniono hasła wszystkich kont',
      `${context.identity} wymusił(a) zmianę haseł wszystkich kont. Zaloguj się i ustaw nowe hasło.`,
    )
    return { ok: true as const }
  })

/** Owner only: ends one panel session (the account has to confirm itself again). */
export const signOutSession = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ tokenHash: z.string().min(10).max(100) }))
  .handler(async ({ data, context }) => {
    const [row] = await db
      .delete(mfaSessions)
      .where(eq(mfaSessions.tokenHash, data.tokenHash))
      .returning({ identity: mfaSessions.identity })
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'revoke_account',
      target: row?.identity ?? 'nieznana sesja',
      details: 'Zakończono jedną sesję (Centrum bezpieczeństwa)',
    })
    return { ok: true as const }
  })
