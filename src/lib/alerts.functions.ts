import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import {
  entryRequests,
  expiryRequests,
  reports,
  securityEvents,
} from '../../db/schema'
import { requireAdmin } from './auth-server'
import { ROLE_ADMIN } from './registry'
import { getSessionUser } from './session-server'
import { mfaSatisfied } from './security-server'

/** Admin only: security alerts, unread first. */
export const listAlerts = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(async () => {
    const rows = await db
      .select()
      .from(securityEvents)
      .where(eq(securityEvents.isAlert, true))
      .orderBy(securityEvents.acknowledged, desc(securityEvents.createdAt))
      .limit(100)
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      kind: row.kind,
      identity: row.identity,
      ip: row.ip,
      details: row.details ?? '',
      acknowledged: row.acknowledged,
    }))
  })

export type AlertRow = Awaited<ReturnType<typeof listAlerts>>[number]

/** Admin only: marks alerts as read (all unread ones when no ids are given). */
export const acknowledgeAlerts = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(z.object({ ids: z.array(z.number().int().positive()).max(200).optional() }))
  .handler(async ({ data }) => {
    const unread = and(
      eq(securityEvents.isAlert, true),
      eq(securityEvents.acknowledged, false),
    )
    const rows = await db
      .select({ id: securityEvents.id })
      .from(securityEvents)
      .where(unread)
    const wanted = data.ids ? new Set(data.ids) : null
    for (const row of rows) {
      if (wanted && !wanted.has(row.id)) continue
      await db
        .update(securityEvents)
        .set({ acknowledged: true })
        .where(eq(securityEvents.id, row.id))
    }
    return { ok: true }
  })

async function countWhere(query: Promise<{ n: string }[]>) {
  const [row] = await query
  return Number(row?.n ?? 0)
}

/** Admin only: what needs attention (shown on the toolbar buttons). */
async function adminCounts() {
  return {
    requests:
      (await countWhere(
        db
          .select({ n: sql<string>`count(*)` })
          .from(entryRequests)
          .where(eq(entryRequests.status, 'pending')),
      )) +
      (await countWhere(
        db
          .select({ n: sql<string>`count(*)` })
          .from(expiryRequests)
          .where(eq(expiryRequests.status, 'pending')),
      )),
    reports: await countWhere(
      db
        .select({ n: sql<string>`count(*)` })
        .from(reports)
        .where(eq(reports.status, 'open')),
    ),
    alerts: await countWhere(
      db
        .select({ n: sql<string>`count(*)` })
        .from(securityEvents)
        .where(
          and(eq(securityEvents.isAlert, true), eq(securityEvents.acknowledged, false)),
        ),
    ),
  }
}

export const getAdminCounts = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(() => adminCounts())

/**
 * Public (used by the site header): the number of things waiting for an admin, or `null`
 * for everyone else, so the header can show a red badge to signed-in admins only.
 */
export const getHeaderBadge = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ count: number | null }> => {
    try {
      const user = await getSessionUser()
      if (!user?.roles.includes(ROLE_ADMIN)) return { count: null }
      if (!(await mfaSatisfied(user.email.toLowerCase()))) return { count: null }
      const c = await adminCounts()
      return { count: c.requests + c.reports + c.alerts }
    } catch {
      return { count: null }
    }
  },
)
