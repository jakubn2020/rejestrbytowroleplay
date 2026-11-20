/** Password login for staff accounts (replaces Netlify Identity). */
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import { users } from '../../db/schema'
import type { AuthUser } from './auth-types'
import {
  endAuthSession,
  endOtherAuthSessions,
  getSessionUser,
  isSuperAdmin,
  startAuthSession,
} from './session-server'
import { loginBlocked, registerLoginFailure } from './login-guard-server'
import { hashPassword, verifyPassword } from './password'
import { logEvent } from './security-server'
import { ROLE_ADMIN, ROLE_MANAGEMENT } from './registry'

/** Hash of a throwaway password, checked when the e-mail is unknown so timing does not reveal it. */
let dummyHash: Promise<string> | null = null

export type LoginResult =
  | { ok: true; user: AuthUser }
  | { ok: false; reason: 'blocked' | 'invalid' }

export const loginUser = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      email: z.string().trim().toLowerCase().max(200),
      password: z.string().min(1).max(200),
    }),
  )
  .handler(async ({ data }): Promise<LoginResult> => {
    if (await loginBlocked()) return { ok: false, reason: 'blocked' }

    const [row] = await db.select().from(users).where(eq(users.email, data.email)).limit(1)
    let valid = false
    if (row) {
      valid = await verifyPassword(data.password, row.passwordHash)
    } else {
      dummyHash ??= hashPassword('nieistniejace-konto')
      await verifyPassword(data.password, await dummyHash)
    }
    const staff = row?.roles.includes(ROLE_ADMIN) || row?.roles.includes(ROLE_MANAGEMENT)
    if (!row || !valid || !staff) {
      await registerLoginFailure(data.email)
      return { ok: false, reason: 'invalid' }
    }

    await startAuthSession(row.id)
    return {
      ok: true,
      user: {
        id: row.id,
        email: row.email,
        roles: row.roles,
        isSuperAdmin: isSuperAdmin(row.email, row.roles),
      },
    }
  })

/** The signed-in account for this browser, or null (also null for accounts without a panel role). */
export const currentUser = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AuthUser | null> => {
    const user = await getSessionUser()
    if (!user) return null
    const staff = user.roles.includes(ROLE_ADMIN) || user.roles.includes(ROLE_MANAGEMENT)
    return staff ? user : null
  },
)

export const logoutUser = createServerFn({ method: 'POST' }).handler(async () => {
  await endAuthSession()
  return { ok: true as const }
})

export type ChangeOwnPasswordResult = { ok: true } | { ok: false; error: string }

/** Any signed-in account changes its own password; other browsers are signed out. */
export const changeOwnPassword = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      currentPassword: z.string().min(1).max(200),
      newPassword: z.string().min(8, 'Hasło musi mieć co najmniej 8 znaków').max(200),
    }),
  )
  .handler(async ({ data }): Promise<ChangeOwnPasswordResult> => {
    const user = await getSessionUser()
    if (!user) return { ok: false, error: 'Sesja wygasła. Zaloguj się ponownie.' }
    const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
    if (!row || !(await verifyPassword(data.currentPassword, row.passwordHash))) {
      return { ok: false, error: 'Obecne hasło jest nieprawidłowe.' }
    }
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(data.newPassword) })
      .where(eq(users.id, user.id))
    await endOtherAuthSessions(user.id)
    await logEvent({
      actor: user.email.toLowerCase(),
      actorRole: user.roles.includes(ROLE_ADMIN) ? ROLE_ADMIN : ROLE_MANAGEMENT,
      action: 'change_password',
      target: user.email,
      details: 'Hasło zmienione przez właściciela konta',
    })
    return { ok: true }
  })
