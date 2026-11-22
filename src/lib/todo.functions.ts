import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, gt, isNotNull, isNull, lt, sql } from 'drizzle-orm'

import { db } from '../../db'
import {
  backups,
  entryRequests,
  expiryRequests,
  practitioners,
  reports,
  securityEvents,
} from '../../db/schema'
import { requireAdmin } from './auth-server'

export type TodoInfo = {
  entryRequests: number
  expiryRequests: number
  /** Hours the oldest pending request has been waiting (null when none). */
  oldestRequestHours: number | null
  reports: number
  alerts: number
  seriousAlerts: number
  expiringSoon: { id: number; name: string; pwz: string; expiresAt: string }[]
  expiredRecently: number
  /** Days since the last backup (null = never); only filled for the owner. */
  backupDays: number | null | undefined
}

async function count(query: Promise<{ n: string }[]>) {
  const [row] = await query
  return Number(row?.n ?? 0)
}

/** Admin only: everything that needs doing now, for the start dashboard. */
export const getTodo = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(async ({ context }): Promise<TodoInfo> => {
    const [oldest] = await db
      .select({ at: entryRequests.createdAt })
      .from(entryRequests)
      .where(eq(entryRequests.status, 'pending'))
      .orderBy(asc(entryRequests.createdAt))
      .limit(1)
    const [oldestExpiry] = await db
      .select({ at: expiryRequests.createdAt })
      .from(expiryRequests)
      .where(eq(expiryRequests.status, 'pending'))
      .orderBy(asc(expiryRequests.createdAt))
      .limit(1)
    const times = [oldest?.at, oldestExpiry?.at].filter((d): d is Date => Boolean(d))
    const first = times.length ? Math.min(...times.map((d) => d.getTime())) : null

    const soon = await db
      .select({
        id: practitioners.id,
        firstName: practitioners.firstName,
        lastName: practitioners.lastName,
        pwz: practitioners.pwz,
        expiresAt: practitioners.expiresAt,
      })
      .from(practitioners)
      .where(
        and(
          isNull(practitioners.deletedAt),
          eq(practitioners.status, 'active'),
          isNotNull(practitioners.expiresAt),
          gt(practitioners.expiresAt, sql`now()`),
          lt(practitioners.expiresAt, sql`now() + interval '7 days'`),
        ),
      )
      .orderBy(asc(practitioners.expiresAt))
      .limit(8)

    let backupDays: number | null | undefined
    if (context.user.isSuperAdmin) {
      const [last] = await db
        .select({ at: backups.createdAt })
        .from(backups)
        .orderBy(desc(backups.createdAt))
        .limit(1)
      backupDays = last ? Math.floor((Date.now() - last.at.getTime()) / 86_400_000) : null
    }

    return {
      entryRequests: await count(
        db.select({ n: sql<string>`count(*)` }).from(entryRequests).where(eq(entryRequests.status, 'pending')),
      ),
      expiryRequests: await count(
        db.select({ n: sql<string>`count(*)` }).from(expiryRequests).where(eq(expiryRequests.status, 'pending')),
      ),
      oldestRequestHours: first === null ? null : Math.floor((Date.now() - first) / 3_600_000),
      reports: await count(
        db.select({ n: sql<string>`count(*)` }).from(reports).where(eq(reports.status, 'open')),
      ),
      alerts: await count(
        db
          .select({ n: sql<string>`count(*)` })
          .from(securityEvents)
          .where(and(eq(securityEvents.isAlert, true), eq(securityEvents.acknowledged, false))),
      ),
      seriousAlerts: await count(
        db
          .select({ n: sql<string>`count(*)` })
          .from(securityEvents)
          .where(
            and(
              eq(securityEvents.isAlert, true),
              eq(securityEvents.acknowledged, false),
              sql`${securityEvents.severity} in ('high','critical')`,
            ),
          ),
      ),
      expiringSoon: soon.map((row) => ({
        id: row.id,
        name: `${row.firstName} ${row.lastName}`,
        pwz: row.pwz,
        expiresAt: (row.expiresAt as Date).toISOString(),
      })),
      expiredRecently: await count(
        db
          .select({ n: sql<string>`count(*)` })
          .from(practitioners)
          .where(
            and(
              isNull(practitioners.deletedAt),
              eq(practitioners.status, 'active'),
              isNotNull(practitioners.expiresAt),
              lt(practitioners.expiresAt, sql`now()`),
              gt(practitioners.expiresAt, sql`now() - interval '7 days'`),
            ),
          ),
      ),
      backupDays,
    }
  })
