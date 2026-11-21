import { createServerFn } from '@tanstack/react-start'
import { and, eq, gte, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import { auditLog, entryRequests, expiryRequests } from '../../db/schema'
import { requireAdmin } from './auth-server'
import { requireStaff } from './auth-server'
import { ROLE_MANAGEMENT, managementBadge } from './registry'

export type ManagementActivityRow = {
  identity: string
  requests: number
  approved: number
  rejected: number
  logins: number
  peselViews: number
  /** Weighted score used for the ranking. */
  score: number
  /** Badge for all-time approved requests (null before the first one). */
  badge: string | null
}

/** All-time number of approved requests (entries and validity changes) per account. */
async function approvedTotals(identity?: string): Promise<Map<string, number>> {
  const totals = new Map<string, number>()
  const entry = await db
    .select({ who: entryRequests.requestedBy, n: sql<string>`count(*)` })
    .from(entryRequests)
    .where(and(eq(entryRequests.status, 'approved'), identity ? eq(entryRequests.requestedBy, identity) : undefined))
    .groupBy(entryRequests.requestedBy)
  const expiry = await db
    .select({ who: expiryRequests.requestedBy, n: sql<string>`count(*)` })
    .from(expiryRequests)
    .where(and(eq(expiryRequests.status, 'approved'), identity ? eq(expiryRequests.requestedBy, identity) : undefined))
    .groupBy(expiryRequests.requestedBy)
  for (const r of [...entry, ...expiry]) totals.set(r.who, (totals.get(r.who) ?? 0) + Number(r.n))
  return totals
}

/** Kierownictwo (or admin): the caller's own badge and approved-request count. */
export const getMyBadge = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(async ({ context }) => {
    const approved = (await approvedTotals(context.identity)).get(context.identity) ?? 0
    return { approved, badge: managementBadge(approved) }
  })

/** Admin only: how active each kierownictwo account was in the last 7, 30 or 90 days. */
export const getManagementActivity = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .validator(z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]) }))
  .handler(async ({ data }): Promise<ManagementActivityRow[]> => {
    const since = new Date(Date.now() - data.days * 86_400_000)
    const map = new Map<string, ManagementActivityRow>()
    const row = (identity: string) => {
      let entry = map.get(identity)
      if (!entry) {
        entry = { identity, requests: 0, approved: 0, rejected: 0, logins: 0, peselViews: 0, score: 0, badge: null }
        map.set(identity, entry)
      }
      return entry
    }

    const entry = await db
      .select({
        who: entryRequests.requestedBy,
        total: sql<string>`count(*)`,
        approved: sql<string>`count(*) filter (where ${entryRequests.status} = 'approved')`,
        rejected: sql<string>`count(*) filter (where ${entryRequests.status} = 'rejected')`,
      })
      .from(entryRequests)
      .where(gte(entryRequests.createdAt, since))
      .groupBy(entryRequests.requestedBy)
    const expiry = await db
      .select({
        who: expiryRequests.requestedBy,
        total: sql<string>`count(*)`,
        approved: sql<string>`count(*) filter (where ${expiryRequests.status} = 'approved')`,
        rejected: sql<string>`count(*) filter (where ${expiryRequests.status} = 'rejected')`,
      })
      .from(expiryRequests)
      .where(gte(expiryRequests.createdAt, since))
      .groupBy(expiryRequests.requestedBy)
    for (const r of [...entry, ...expiry]) {
      const target = row(r.who)
      target.requests += Number(r.total)
      target.approved += Number(r.approved)
      target.rejected += Number(r.rejected)
    }

    const audit = await db
      .select({
        who: auditLog.actor,
        logins: sql<string>`count(*) filter (where ${auditLog.action} = 'login')`,
        views: sql<string>`count(*) filter (where ${auditLog.action} = 'pesel_view')`,
      })
      .from(auditLog)
      .where(and(eq(auditLog.actorRole, ROLE_MANAGEMENT), gte(auditLog.createdAt, since)))
      .groupBy(auditLog.actor)
    for (const r of audit) {
      const target = row(r.who)
      target.logins = Number(r.logins)
      target.peselViews = Number(r.views)
    }

    const rows = [...map.values()]
    const totals = await approvedTotals()
    for (const r of rows) {
      r.score = r.requests * 3 + r.approved + r.logins + r.peselViews
      r.badge = managementBadge(totals.get(r.identity) ?? 0)
    }
    return rows.sort((a, b) => b.score - a.score).slice(0, 15)
  })
