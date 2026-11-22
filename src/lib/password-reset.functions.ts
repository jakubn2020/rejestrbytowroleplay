import { createServerFn } from '@tanstack/react-start'
import { and, eq, gt, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import { authSessions, mfaSessions, passwordResets, users } from '../../db/schema'
import { ipBanned } from './ip-policy-server'
import { hashPassword } from './password'
import { isWeakPassword } from './password-strength'
import { ROLE_ADMIN, ROLE_MANAGEMENT } from './registry'
import { logEvent, recordEvent, sha256 } from './security-server'

export type ResetResult = { ok: true } | { ok: false; error: string }

/** Public: sets a new password with a one-time link from the owner. The link works once. */
export const consumePasswordReset = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      token: z.string().regex(/^[0-9a-f]{64}$/),
      password: z.string().min(8, 'Hasło musi mieć co najmniej 8 znaków').max(200),
    }),
  )
  .handler(async ({ data }): Promise<ResetResult> => {
    if (await ipBanned()) return { ok: false, error: 'Dostęp z tego adresu został zablokowany.' }
    const [claimed] = await db
      .delete(passwordResets)
      .where(
        and(
          eq(passwordResets.tokenHash, sha256(data.token)),
          gt(passwordResets.expiresAt, sql`now()`),
        ),
      )
      .returning({ userId: passwordResets.userId })
    if (!claimed) {
      await recordEvent({ kind: 'reset_invalid' })
      return { ok: false, error: 'Link jest nieprawidłowy, wygasł albo został już użyty.' }
    }
    const [user] = await db.select().from(users).where(eq(users.id, claimed.userId)).limit(1)
    if (!user) return { ok: false, error: 'Nie znaleziono konta.' }
    await db
      .update(users)
      .set({
        passwordHash: await hashPassword(data.password),
        mustChangePassword: false,
        weakPassword: isWeakPassword(data.password, user.email),
      })
      .where(eq(users.id, user.id))
    await db.delete(authSessions).where(eq(authSessions.userId, user.id))
    await db.delete(mfaSessions).where(eq(mfaSessions.identity, user.email))
    await logEvent({
      actor: user.email,
      actorRole: user.roles.includes(ROLE_ADMIN) ? ROLE_ADMIN : ROLE_MANAGEMENT,
      action: 'change_password',
      target: user.email,
      details: 'Hasło ustawione z jednorazowego linku od właściciela',
    })
    return { ok: true }
  })
