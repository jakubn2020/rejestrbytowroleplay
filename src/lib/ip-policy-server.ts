/** Server-only: blocked and allowed addresses (single IPs and CIDR ranges), temporary bans. */
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm'

import { db } from '../../db'
import { ipRules } from '../../db/schema'
import { ipMatchesRule } from './ip-rules'
import { clientIp, raiseAlert } from './security-server'
import { SEC_KEYS, readNumberSetting } from './site-settings-server'

/** Rules of one kind that have not expired. */
export async function activeRules(kind: 'block' | 'allow') {
  return db
    .select()
    .from(ipRules)
    .where(
      and(
        eq(ipRules.kind, kind),
        or(isNull(ipRules.expiresAt), gt(ipRules.expiresAt, sql`now()`)),
      ),
    )
}

/** Is this address blocked (permanently or by a temporary ban)? Errors count as "not blocked". */
export async function ipBanned(ip: string | null = clientIp()): Promise<boolean> {
  if (!ip) return false
  try {
    const rules = await activeRules('block')
    return rules.some((rule) => ipMatchesRule(ip, rule.rule))
  } catch (error) {
    console.error('Nie udało się sprawdzić listy zablokowanych adresów', error)
    return false
  }
}

/**
 * May this address use the admin panel? Only restricted when the whitelist is switched on AND
 * contains at least one rule (so an empty list can never lock everybody out).
 */
export async function panelIpAllowed(ip: string | null = clientIp()): Promise<boolean> {
  try {
    if ((await readNumberSetting(SEC_KEYS.whitelist, 0)) !== 1) return true
    const rules = await activeRules('allow')
    if (rules.length === 0) return true
    if (!ip) return false
    return rules.some((rule) => ipMatchesRule(ip, rule.rule))
  } catch (error) {
    console.error('Nie udało się sprawdzić białej listy adresów', error)
    return true
  }
}

/**
 * Permanent block of an address: it stays blocked until the owner removes the rule by hand
 * (security centre → "Adresy IP i ruch"). Replaces a temporary ban of the same address.
 * Returns false when the address was already locked permanently.
 */
export async function lockIp(ip: string, reason: string): Promise<boolean> {
  try {
    const rules = await activeRules('block')
    if (rules.some((rule) => rule.rule === ip && rule.expiresAt === null)) return false
    await db
      .delete(ipRules)
      .where(and(eq(ipRules.kind, 'block'), eq(ipRules.rule, ip), eq(ipRules.auto, true)))
    await db.insert(ipRules).values({
      kind: 'block',
      rule: ip,
      reason,
      createdBy: 'automat',
      expiresAt: null,
      auto: true,
    })
    return true
  } catch (error) {
    console.error('Nie udało się trwale zablokować adresu', error)
    return false
  }
}

/** Temporary ban of an address (minutes); an existing active ban for the same address is kept. */
export async function autoBan(ip: string, minutes: number, reason: string): Promise<void> {
  try {
    const rules = await activeRules('block')
    if (rules.some((rule) => rule.rule === ip)) return
    await db.insert(ipRules).values({
      kind: 'block',
      rule: ip,
      reason,
      createdBy: 'automat',
      expiresAt: new Date(Date.now() + minutes * 60_000),
      auto: true,
    })
    await raiseAlert({
      kind: 'ip_autoban',
      ip,
      details: `Adres ${ip} został automatycznie zablokowany na ${minutes} minut: ${reason}.`,
      dedupeMinutes: minutes,
      severity: 'medium',
    })
    if (Math.random() < 0.1) {
      await db.delete(ipRules).where(and(lt(ipRules.expiresAt, sql`now() - interval '7 days'`)))
    }
  } catch (error) {
    console.error('Nie udało się zablokować adresu', error)
  }
}
