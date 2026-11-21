import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, gt, ne, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import { authSessions, mfaSessions, securityEvents, users } from '../../db/schema'
import { requireSuperAdmin } from './auth-server'
import { ROLE_ADMIN } from './registry'
import { AUTH_COOKIE } from './session-server'
import {
  MFA_COOKIE,
  logEvent,
  notifyAdmins,
  readCookie,
  sha256,
} from './security-server'

const hoursAgo = (h: number) => sql`now() - ${sql.raw(`interval '${h} hours'`)}`

async function countKind(kind: string, hours: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<string>`count(*)` })
    .from(securityEvents)
    .where(and(eq(securityEvents.kind, kind), gt(securityEvents.createdAt, hoursAgo(hours))))
  return Number(row?.n ?? 0)
}

export type SecurityOverview = {
  activeSessions: number
  signedInAccounts: number
  failedLogins24h: number
  newDevices7d: number
  peselViews24h: number
  openAlerts: number
}

/** Owner only: numbers for the security centre. */
export const getSecurityOverview = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .handler(async (): Promise<SecurityOverview> => {
    const [sessions] = await db
      .select({
        n: sql<string>`count(*)`,
        who: sql<string>`count(distinct ${mfaSessions.identity})`,
      })
      .from(mfaSessions)
      .where(gt(mfaSessions.expiresAt, sql`now()`))
    const [alerts] = await db
      .select({ n: sql<string>`count(*)` })
      .from(securityEvents)
      .where(and(eq(securityEvents.isAlert, true), eq(securityEvents.acknowledged, false)))
    return {
      activeSessions: Number(sessions?.n ?? 0),
      signedInAccounts: Number(sessions?.who ?? 0),
      failedLogins24h: await countKind('login_failed', 24),
      newDevices7d: await countKind('new_device', 24 * 7),
      peselViews24h: await countKind('pesel_view', 24),
      openAlerts: Number(alerts?.n ?? 0),
    }
  })

export type ActiveSession = {
  tokenHash: string
  identity: string
  ip: string | null
  userAgent: string | null
  createdAt: string
  expiresAt: string
}

/** Owner only: every panel session that is still valid. */
export const listAllSessions = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .handler(async (): Promise<ActiveSession[]> => {
    const rows = await db
      .select()
      .from(mfaSessions)
      .where(gt(mfaSessions.expiresAt, sql`now()`))
      .orderBy(desc(mfaSessions.createdAt))
      .limit(200)
    return rows.map((row) => ({
      tokenHash: row.tokenHash,
      identity: row.identity,
      ip: row.ip,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    }))
  })

export type SecurityEventRow = {
  id: number
  createdAt: string
  kind: string
  identity: string | null
  ip: string | null
  details: string | null
  isAlert: boolean
}

/** Owner only: the latest security events (logins, failures, alerts). */
export const listSecurityEvents = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .handler(async (): Promise<SecurityEventRow[]> => {
    const rows = await db
      .select()
      .from(securityEvents)
      .orderBy(desc(securityEvents.createdAt))
      .limit(80)
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      kind: row.kind,
      identity: row.identity,
      ip: row.ip,
      details: row.details,
      isAlert: row.isAlert,
    }))
  })

/** Owner only: signs one account out everywhere (the owner's own current browser is kept). */
export const signOutAccount = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ identity: z.string().trim().toLowerCase().min(1).max(200) }))
  .handler(async ({ data, context }) => {
    const keepAuth = readCookie(AUTH_COOKIE)
    const keepMfa = readCookie(MFA_COOKIE)
    const own = data.identity === context.identity
    await db
      .delete(mfaSessions)
      .where(
        and(
          eq(mfaSessions.identity, data.identity),
          own && keepMfa ? ne(mfaSessions.tokenHash, sha256(keepMfa)) : undefined,
        ),
      )
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, data.identity)).limit(1)
    if (user) {
      await db
        .delete(authSessions)
        .where(
          and(
            eq(authSessions.userId, user.id),
            own && keepAuth ? ne(authSessions.tokenHash, sha256(keepAuth)) : undefined,
          ),
        )
    }
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'revoke_account',
      target: data.identity,
      details: 'Wylogowano konto na wszystkich urządzeniach (Centrum bezpieczeństwa)',
    })
    return { ok: true as const }
  })

/** Owner only: emergency button, signs every account out (except the owner's current browser). */
export const signOutEveryone = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .handler(async ({ context }) => {
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
      action: 'logout_everyone',
      target: 'Wszystkie konta',
      details: 'Wylogowano wszystkich użytkowników (Centrum bezpieczeństwa)',
    })
    await notifyAdmins(
      'Wylogowano wszystkich użytkowników',
      `${context.identity} wylogował(a) wszystkich użytkowników panelu. Zaloguj się ponownie.`,
    )
    return { ok: true as const }
  })
