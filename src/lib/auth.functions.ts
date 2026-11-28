/** Password login for staff accounts (replaces Netlify Identity). */
import { createServerFn } from '@tanstack/react-start'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import { users } from '../../db/schema'
import type { AuthUser } from './auth-types'
import {
  endAuthSession,
  endOtherAuthSessions,
  getSessionUser,
  isRootOwner,
  isSuperAdmin,
  startAuthSession,
} from './session-server'
import { ipBanned, panelIpAllowed } from './ip-policy-server'
import { loginBlocked, registerLoginFailure } from './login-guard-server'
import { newPasswordSchema } from './password-schema'
import { isWeakPassword } from './password-strength'
import { SEC_KEYS, readNumberSetting, readSetting, writeSetting } from './site-settings-server'
import { userKey } from './examiners'
import { hashPassword, verifyPassword } from './password'
import { logEvent, notifyAdmins, clientIp } from './security-server'
import { deniedFor, roleIpKey } from './permissions-server'
import { PERMISSION_ROLES } from './permissions'
import { ipMatchesRule } from './ip-rules'
import { ROLE_ADMIN, ROLE_MANAGEMENT, hasPanelRole } from './registry'

/** Hash of a throwaway password, checked when the e-mail is unknown so timing does not reveal it. */
let dummyHash: Promise<string> | null = null

function parseJson(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The owner may limit a role to some addresses; a person with several roles passes if any of them has no limit. */
async function roleIpAllowed(roles: string[]): Promise<boolean> {
  try {
    const lists = await Promise.all(
      PERMISSION_ROLES.filter((r) => roles.includes(r.role)).map(async (r) =>
        ((await readSetting(roleIpKey(r.role))) ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
      ),
    )
    if (lists.length === 0 || lists.some((list) => list.length === 0)) return true
    const ip = clientIp()
    if (!ip) return false
    return lists.some((list) => list.some((rule) => ipMatchesRule(ip, rule)))
  } catch (error) {
    console.error('Nie udało się sprawdzić adresów dozwolonych dla roli', error)
    return true
  }
}

export type LoginResult =
  | { ok: true; user: AuthUser }
  | { ok: false; reason: 'blocked' | 'invalid' | 'locked' }
  /** The password was right but a moderator suspended the account: the reason may be shown and an appeal sent. */
  | { ok: false; reason: 'suspended'; until: string; why: string | null; appealSent: boolean }

export const loginUser = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      email: z.string().trim().toLowerCase().max(200),
      password: z.string().min(1).max(200),
    }),
  )
  .handler(async ({ data }): Promise<LoginResult> => {
    if ((await loginBlocked()) || (await ipBanned())) return { ok: false, reason: 'blocked' }

    const [row] = await db.select().from(users).where(eq(users.email, data.email)).limit(1)
    let valid = false
    if (row) {
      valid = await verifyPassword(data.password, row.passwordHash)
    } else {
      dummyHash ??= hashPassword('nieistniejace-konto')
      await verifyPassword(data.password, await dummyHash)
    }
    const staff = row ? hasPanelRole(row.roles) : false
    if (!row || !valid || !staff) {
      await registerLoginFailure(data.email)
      return { ok: false, reason: 'invalid' }
    }

    // Only the real owner skips the lock / IP checks (a co-owner has the powers, not the exemption).
    const owner = isRootOwner(row.email, row.roles)
    if (!owner) {
      // Checked only after the password was right, so nobody can probe which accounts are blocked.
      const unusedDays = await readNumberSetting(SEC_KEYS.unusedDays, 60)
      const idleSince = row.lastLoginAt?.getTime()
      if (
        !row.locked &&
        unusedDays > 0 &&
        idleSince !== undefined &&
        Date.now() - idleSince > unusedDays * 86_400_000
      ) {
        await db
          .update(users)
          .set({ locked: true, lockedReason: `Nieużywane konto (ponad ${unusedDays} dni bez logowania)` })
          .where(eq(users.id, row.id))
        return { ok: false, reason: 'locked' }
      }
      if (row.locked) return { ok: false, reason: 'locked' }
      if (row.frozenUntil && row.frozenUntil.getTime() > Date.now()) {
        const suspension = parseJson(await readSetting(userKey.suspension(row.id)))
        return {
          ok: false,
          reason: 'suspended',
          until: row.frozenUntil.toISOString(),
          why: typeof suspension?.reason === 'string' && suspension.reason ? suspension.reason : null,
          appealSent: (await readSetting(userKey.appeal(row.id))) !== null,
        }
      }
      if ((await readNumberSetting(SEC_KEYS.lockdown, 0)) === 1) return { ok: false, reason: 'locked' }
      if (!(await roleIpAllowed(row.roles))) return { ok: false, reason: 'blocked' }
      if (row.roles.includes(ROLE_ADMIN) && !(await panelIpAllowed())) {
        return { ok: false, reason: 'blocked' }
      }
    }
    await db
      .update(users)
      .set({
        lastLoginAt: sql`now()`,
        weakPassword: isWeakPassword(data.password, row.email),
      })
      .where(eq(users.id, row.id))
    await startAuthSession(row.id)
    return {
      ok: true,
      user: {
        id: row.id,
        email: row.email,
        roles: row.roles,
        isSuperAdmin: isSuperAdmin(row.email, row.roles),
        isRootOwner: owner,
        mustChangePassword: row.mustChangePassword,
        denied: await deniedFor({ id: row.id, roles: row.roles, isSuperAdmin: isSuperAdmin(row.email, row.roles) }),
      },
    }
  })

/** The signed-in account for this browser, or null (also null for accounts without a panel role). */
export const currentUser = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AuthUser | null> => {
    const user = await getSessionUser()
    if (!user) return null
    if (!hasPanelRole(user.roles)) return null
    return { ...user, denied: await deniedFor(user) }
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
      newPassword: newPasswordSchema,
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
      .set({
        passwordHash: await hashPassword(data.newPassword),
        mustChangePassword: false,
        weakPassword: isWeakPassword(data.newPassword, user.email),
      })
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

export type AppealResult = { ok: true } | { ok: false; error: string }

/** A suspended account (right password required) sends one appeal that the moderators and admins see. */
export const appealSuspension = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      email: z.string().trim().toLowerCase().max(200),
      password: z.string().min(1).max(200),
      message: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ data }): Promise<AppealResult> => {
    if ((await loginBlocked()) || (await ipBanned())) {
      return { ok: false, error: 'Wysyłanie jest teraz niedostępne. Spróbuj później.' }
    }
    const [row] = await db.select().from(users).where(eq(users.email, data.email)).limit(1)
    if (!row || !(await verifyPassword(data.password, row.passwordHash))) {
      await registerLoginFailure(data.email)
      return { ok: false, error: 'Nieprawidłowy e-mail lub hasło.' }
    }
    if (!row.frozenUntil || row.frozenUntil.getTime() <= Date.now()) {
      return { ok: false, error: 'To konto nie jest zawieszone.' }
    }
    if ((await readSetting(userKey.appeal(row.id))) !== null) {
      return { ok: false, error: 'Odwołanie zostało już wysłane. Poczekaj na odpowiedź moderatora.' }
    }
    await writeSetting(userKey.appeal(row.id), JSON.stringify({ at: new Date().toISOString(), message: data.message ?? '' }))
    await logEvent({
      actor: row.email,
      actorRole: row.roles[0] ?? 'brak',
      action: 'examiner_appeal',
      target: row.email,
      details: data.message || 'Odwołanie od zawieszenia',
    })
    await notifyAdmins(
      'Odwołanie od zawieszenia konta',
      `${row.email} odwołuje się od zawieszenia konta.${data.message ? ` Wiadomość: ${data.message}` : ''}`,
    )
    return { ok: true }
  })
