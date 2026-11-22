/**
 * Anonymous visit statistics for the whole site. Only counters are stored: views per day
 * and page, and one salted hash per visitor per day (no IP address, no cookies).
 */
import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { and, asc, desc, gte, lt, ne, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import { visitStats, visitUniques } from '../../db/schema'
import { requireAdmin } from './auth-server'
import { clientIp, sha256 } from './security-server'

const BOT = /bot|crawl|spider|slurp|headless|preview|monitor|curl|wget|python|node-fetch/i

function warsawDay(date: Date): string {
  // sv-SE formats dates as YYYY-MM-DD
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(date)
}

/** Groups dynamic pages so the statistics stay readable. */
function normalizePath(raw: string): string {
  const path = raw.split(/[?#]/)[0] || '/'
  if (path === '/') return '/'
  if (path.startsWith('/weryfikacja/')) return '/weryfikacja/*'
  if (['/jak-to-dziala', '/zglos-blad'].includes(path)) return path
  return 'inne'
}

/** Public: counts one page view (called by the site header on every page change). */
export const trackVisit = createServerFn({ method: 'POST' })
  .validator(z.object({ path: z.string().max(200) }))
  .handler(async ({ data }) => {
    const userAgent = getRequestHeader('user-agent') ?? ''
    const day = warsawDay(new Date())
    if (!userAgent || BOT.test(userAgent)) {
      // Not counted as a visit, but tallied so the owner can see how much automated traffic there is.
      await db
        .insert(visitStats)
        .values({ id: `${day}|__bot`, day, path: '__bot', views: 1 })
        .onConflictDoUpdate({ target: visitStats.id, set: { views: sql`${visitStats.views} + 1` } })
      return { ok: true }
    }
    const path = normalizePath(data.path)
    await db
      .insert(visitStats)
      .values({ id: `${day}|${path}`, day, path, views: 1 })
      .onConflictDoUpdate({
        target: visitStats.id,
        set: { views: sql`${visitStats.views} + 1` },
      })
    const ip = clientIp()
    if (ip) {
      const salt = process.env.DATABASE_URL ?? 'rejestr'
      const visitor = sha256(`${salt}|${day}|${ip}|${userAgent}`).slice(0, 32)
      await db
        .insert(visitUniques)
        .values({ id: `${day}|${visitor}`, day })
        .onConflictDoNothing()
    }
    if (Math.random() < 0.02) {
      const cutoff = warsawDay(new Date(Date.now() - 100 * 86_400_000))
      await db.delete(visitUniques).where(lt(visitUniques.day, cutoff))
    }
    return { ok: true }
  })

export type VisitStats = {
  days: { day: string; views: number; visitors: number }[]
  pages: { path: string; views: number }[]
  totalViews: number
  totalVisitors: number
}

/** Admin only: views and visitors per day plus the most visited pages. */
export const getVisitStats = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .validator(z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]) }))
  .handler(async ({ data }): Promise<VisitStats> => {
    const first = warsawDay(new Date(Date.now() - (data.days - 1) * 86_400_000))
    const views = await db
      .select({ day: visitStats.day, n: sql<string>`sum(${visitStats.views})` })
      .from(visitStats)
      .where(and(gte(visitStats.day, first), ne(visitStats.path, '__bot')))
      .groupBy(visitStats.day)
      .orderBy(asc(visitStats.day))
    const visitors = await db
      .select({ day: visitUniques.day, n: sql<string>`count(*)` })
      .from(visitUniques)
      .where(and(gte(visitUniques.day, first)))
      .groupBy(visitUniques.day)
    const pages = await db
      .select({ path: visitStats.path, n: sql<string>`sum(${visitStats.views})` })
      .from(visitStats)
      .where(and(gte(visitStats.day, first), ne(visitStats.path, '__bot')))
      .groupBy(visitStats.path)
      .orderBy(desc(sql`sum(${visitStats.views})`))
      .limit(15)

    const viewsByDay = new Map(views.map((r) => [r.day, Number(r.n)]))
    const visitorsByDay = new Map(visitors.map((r) => [r.day, Number(r.n)]))
    const days: VisitStats['days'] = []
    for (let i = data.days - 1; i >= 0; i--) {
      const day = warsawDay(new Date(Date.now() - i * 86_400_000))
      days.push({
        day,
        views: viewsByDay.get(day) ?? 0,
        visitors: visitorsByDay.get(day) ?? 0,
      })
    }
    return {
      days,
      pages: pages.map((r) => ({ path: r.path, views: Number(r.n) })),
      totalViews: days.reduce((sum, d) => sum + d.views, 0),
      totalVisitors: days.reduce((sum, d) => sum + d.visitors, 0),
    }
  })
