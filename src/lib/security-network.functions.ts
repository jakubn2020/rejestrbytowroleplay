import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, gt, isNotNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import { ipRules, securityEvents, traffic, visitStats } from '../../db/schema'
import { requireSuperAdmin } from './auth-server'
import { activeRules } from './ip-policy-server'
import { isValidRule } from './ip-rules'
import { ROLE_ADMIN } from './registry'
import { logEvent } from './security-server'
import { SEC_KEYS, readNumberSetting, writeSetting } from './site-settings-server'

export type IpRuleRow = {
  id: number
  kind: 'block' | 'allow'
  rule: string
  reason: string | null
  createdBy: string
  createdAt: string
  expiresAt: string | null
  auto: boolean
}

/** Owner only: blocked addresses/ranges (with temporary bans) and the whitelist of the admin panel. */
export const listIpRules = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .handler(async () => {
    const block = await activeRules('block')
    const allow = await activeRules('allow')
    const toRow = (row: (typeof block)[number]): IpRuleRow => ({
      id: row.id,
      kind: row.kind === 'allow' ? 'allow' : 'block',
      rule: row.rule,
      reason: row.reason,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      auto: row.auto,
    })
    return {
      block: block.map(toRow).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      allow: allow.map(toRow),
      whitelistEnabled: (await readNumberSetting(SEC_KEYS.whitelist, 0)) === 1,
    }
  })

/** Owner only: blocks or allows an address or CIDR range, optionally only for some hours. */
export const addIpRule = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(
    z.object({
      kind: z.enum(['block', 'allow']),
      rule: z.string().trim().min(3).max(60),
      reason: z.string().trim().max(200).optional(),
      hours: z.number().int().min(0).max(24 * 365).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    if (!isValidRule(data.rule)) {
      return { ok: false as const, error: 'To nie jest poprawny adres IP ani zakres (np. 203.0.113.0/24).' }
    }
    await db.insert(ipRules).values({
      kind: data.kind,
      rule: data.rule,
      reason: data.reason || null,
      createdBy: context.identity,
      expiresAt: data.hours ? new Date(Date.now() + data.hours * 3_600_000) : null,
    })
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'ip_rule',
      target: data.rule,
      details: `${data.kind === 'block' ? 'Zablokowano' : 'Dodano do białej listy'}${data.hours ? ` na ${data.hours} godz.` : ''}${data.reason ? `: ${data.reason}` : ''}`,
    })
    return { ok: true as const }
  })

/** Owner only: removes (unblocks) a rule. */
export const removeIpRule = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data, context }) => {
    const [row] = await db.delete(ipRules).where(eq(ipRules.id, data.id)).returning()
    if (row) {
      await logEvent({
        actor: context.identity,
        actorRole: ROLE_ADMIN,
        action: 'ip_rule',
        target: row.rule,
        details: row.kind === 'block' ? 'Odblokowano adres' : 'Usunięto z białej listy',
      })
    }
    return { ok: true as const }
  })

/** Owner only: switches the admin-panel whitelist on or off (needs at least one allowed address). */
export const setWhitelist = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ enabled: z.boolean() }))
  .handler(async ({ data, context }) => {
    if (data.enabled && (await activeRules('allow')).length === 0) {
      return { ok: false as const, error: 'Najpierw dodaj przynajmniej jeden dozwolony adres.' }
    }
    await writeSetting(SEC_KEYS.whitelist, data.enabled ? '1' : '0')
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'ip_rule',
      target: 'Biała lista panelu',
      details: data.enabled ? 'Włączono (właściciel jest zawsze wyłączony z ograniczenia)' : 'Wyłączono',
    })
    return { ok: true as const }
  })

export type TrafficInfo = {
  minutes: { minute: string; hits: number }[]
  spikeThreshold: number
  topIps: { ip: string; hits: number }[]
  botsFiltered: number
}

/** Owner only: requests to the public search per minute (last hour), top addresses (24 h). */
export const getTraffic = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .handler(async (): Promise<TrafficInfo> => {
    const now = Date.now()
    const keyOf = (t: number) => new Date(t).toISOString().slice(0, 16)
    const since = keyOf(now - 59 * 60_000)
    const rows = await db
      .select({ minute: traffic.minute, hits: sql<string>`sum(${traffic.hits})` })
      .from(traffic)
      .where(sql`${traffic.minute} >= ${since}`)
      .groupBy(traffic.minute)
    const byMinute = new Map(rows.map((r) => [r.minute, Number(r.hits)]))
    const minutes: TrafficInfo['minutes'] = []
    for (let i = 59; i >= 0; i--) {
      const minute = keyOf(now - i * 60_000)
      minutes.push({ minute, hits: byMinute.get(minute) ?? 0 })
    }
    const values = minutes.map((m) => m.hits)
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)
    const spikeThreshold = Math.max(15, Math.ceil(mean + 3 * sd))

    const day = keyOf(now - 24 * 3_600_000)
    const top = await db
      .select({ ip: traffic.ip, hits: sql<string>`sum(${traffic.hits})` })
      .from(traffic)
      .where(sql`${traffic.minute} >= ${day}`)
      .groupBy(traffic.ip)
      .orderBy(desc(sql`sum(${traffic.hits})`))
      .limit(15)

    const [bots] = await db
      .select({ n: sql<string>`coalesce(sum(${visitStats.views}), 0)` })
      .from(visitStats)
      .where(eq(visitStats.path, '__bot'))
    return {
      minutes,
      spikeThreshold,
      topIps: top.map((r) => ({ ip: r.ip, hits: Number(r.hits) })),
      botsFiltered: Number(bots?.n ?? 0),
    }
  })

export type CountryRow = { country: string; logins: number; accounts: number }

/** Owner only: where staff logged in from in the last 30 days (country codes from Cloudflare). */
export const getLoginCountries = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .handler(async (): Promise<CountryRow[]> => {
    const rows = await db
      .select({
        country: securityEvents.country,
        logins: sql<string>`count(*)`,
        accounts: sql<string>`count(distinct ${securityEvents.identity})`,
      })
      .from(securityEvents)
      .where(
        and(
          eq(securityEvents.kind, 'login'),
          isNotNull(securityEvents.country),
          gt(securityEvents.createdAt, sql`now() - interval '30 days'`),
        ),
      )
      .groupBy(securityEvents.country)
      .orderBy(desc(sql`count(*)`))
    return rows.map((r) => ({
      country: r.country ?? '??',
      logins: Number(r.logins),
      accounts: Number(r.accounts),
    }))
  })
