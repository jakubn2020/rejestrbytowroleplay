/** Server-only: password-login sessions and the signed-in user. */
import { randomBytes } from 'node:crypto'
import { setResponseHeader } from '@tanstack/react-start/server'
import { and, eq, gt, lt, ne, sql } from 'drizzle-orm'

import { db } from '../../db'
import { authSessions, users } from '../../db/schema'
import type { AuthUser } from './auth-types'
import { ROLE_ADMIN } from './registry'
import { readCookie, sha256 } from './security-server'

export const AUTH_COOKIE = 'rejestr_auth'
const AUTH_HOURS = 12

/** The owner account: the only one that may add and remove other admin accounts. */
export function superAdminEmail(): string {
  return (process.env.SUPERADMIN_EMAIL ?? '').trim().toLowerCase()
}

export function isSuperAdmin(email: string, roles: string[]): boolean {
  const owner = superAdminEmail()
  return owner !== '' && email.toLowerCase() === owner && roles.includes(ROLE_ADMIN)
}

/** Starts a password-login session: stores the token hash and sets the HttpOnly cookie. */
export async function startAuthSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('hex')
  await db.insert(authSessions).values({
    tokenHash: sha256(token),
    userId,
    expiresAt: sql`now() + ${sql.raw(`interval '${AUTH_HOURS} hours'`)}`,
  })
  await db.delete(authSessions).where(lt(authSessions.expiresAt, sql`now()`))
  setResponseHeader(
    'Set-Cookie',
    `${AUTH_COOKIE}=${token}; Path=/; Max-Age=${AUTH_HOURS * 3600}; HttpOnly; Secure; SameSite=Lax`,
  )
}

export async function endAuthSession(): Promise<void> {
  const token = readCookie(AUTH_COOKIE)
  if (token) {
    await db.delete(authSessions).where(eq(authSessions.tokenHash, sha256(token)))
  }
  setResponseHeader(
    'Set-Cookie',
    `${AUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
  )
}

/** Ends every password session of one account, optionally keeping the current browser's. */
export async function endOtherAuthSessions(userId: string): Promise<void> {
  const token = readCookie(AUTH_COOKIE)
  const conditions = [eq(authSessions.userId, userId)]
  if (token) conditions.push(ne(authSessions.tokenHash, sha256(token)))
  await db.delete(authSessions).where(and(...conditions))
}

/** The account behind this browser's session cookie, or null. */
export async function getSessionUser(): Promise<AuthUser | null> {
  const token = readCookie(AUTH_COOKIE)
  if (!token) return null
  const [row] = await db
    .select({ id: users.id, email: users.email, roles: users.roles })
    .from(authSessions)
    .innerJoin(users, eq(users.id, authSessions.userId))
    .where(
      and(
        eq(authSessions.tokenHash, sha256(token)),
        gt(authSessions.expiresAt, sql`now()`),
      ),
    )
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    roles: row.roles,
    isSuperAdmin: isSuperAdmin(row.email, row.roles),
  }
}

