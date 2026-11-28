import { createServerFn } from '@tanstack/react-start'
import { eq, like, or } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import { settings, users } from '../../db/schema'
import { requireSuperAdmin } from './auth-server'
import { isValidRule } from './ip-rules'
import {
  PERMISSIONS,
  PERMISSION_ROLES,
  permissionByKey,
  resolvePermission,
  roleHasByDefault,
  type PersonExceptions,
  type Resolution,
  type RoleDenials,
} from './permissions'
import {
  PERM_HISTORY_KEY,
  PERM_ROLES_KEY,
  parseDenials,
  parseExceptions,
  permUserKey,
  roleIpKey,
} from './permissions-server'
import {
  applyPersonExceptions,
  pushHistory,
  readHistory,
  writePerson,
  type PermissionChange,
} from './person-permissions-server'
import { ROLE_ADMIN, hasPanelRole } from './registry'
import { logEvent } from './security-server'
import { isSuperAdmin } from './session-server'
import { clearSetting, readSetting, writeSetting } from './site-settings-server'

// ---------------------------------------------------------------------------
// History (so a change can be undone)
// ---------------------------------------------------------------------------

export type { PermissionChange }

const roleLabel = (role: string) => PERMISSION_ROLES.find((r) => r.role === role)?.label ?? role

async function readDenials(): Promise<RoleDenials> {
  return parseDenials(await readSetting(PERM_ROLES_KEY))
}

async function writeRoleList(role: string, keys: string[]): Promise<string[]> {
  // Only permissions the role has by default can be switched off.
  const valid = [...new Set(keys)].filter((key) => roleHasByDefault(role, key))
  const denials = await readDenials()
  if (valid.length) denials[role] = valid
  else delete denials[role]
  if (Object.keys(denials).length) await writeSetting(PERM_ROLES_KEY, JSON.stringify(denials))
  else await clearSetting(PERM_ROLES_KEY)
  return valid
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export type PermissionAccount = {
  id: string
  email: string
  roles: string[]
  isOwner: boolean
  locked: boolean
  lastLoginAt: string | null
  exceptions: PersonExceptions
}

export type PermissionOverview = {
  denials: RoleDenials
  accounts: PermissionAccount[]
  roleIps: Record<string, string>
  history: PermissionChange[]
}

export const getPermissionOverview = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .handler(async (): Promise<PermissionOverview> => {
    const rows = await db.select().from(users).orderBy(users.email)
    const stored = await db
      .select()
      .from(settings)
      .where(or(like(settings.key, 'perm\\_user\\_%'), like(settings.key, 'ip\\_role\\_%')))
    const roleIps: Record<string, string> = {}
    for (const { role } of PERMISSION_ROLES) {
      roleIps[role] = stored.find((s) => s.key === roleIpKey(role))?.value ?? ''
    }
    return {
      denials: await readDenials(),
      accounts: rows
        .filter((row) => hasPanelRole(row.roles))
        .map((row) => ({
          id: row.id,
          email: row.email,
          roles: row.roles,
          isOwner: isSuperAdmin(row.email, row.roles),
          locked: row.locked,
          lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
          exceptions: parseExceptions(stored.find((s) => s.key === permUserKey(row.id))?.value),
        })),
      roleIps,
      history: (await readHistory()).slice(0, 40),
    }
  })

// ---------------------------------------------------------------------------
// Role switches (the checklist)
// ---------------------------------------------------------------------------

/** Owner: the list of permissions switched OFF for a whole role. */
export const saveRolePermissions = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ role: z.string().max(60), denied: z.array(z.string().max(60)).max(60) }))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (!PERMISSION_ROLES.some((r) => r.role === data.role)) return { ok: false, error: 'Nieznana rola.' }
    const before = (await readDenials())[data.role] ?? []
    const after = await writeRoleList(data.role, data.denied)
    if (JSON.stringify([...before].sort()) === JSON.stringify([...after].sort())) return { ok: true }
    const added = after.filter((k) => !before.includes(k)).map((k) => permissionByKey(k)?.label ?? k)
    const removed = before.filter((k) => !after.includes(k)).map((k) => permissionByKey(k)?.label ?? k)
    const summary = [
      added.length ? `wyłączono: ${added.join(', ')}` : '',
      removed.length ? `włączono: ${removed.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ')
    await pushHistory({
      by: context.identity,
      scope: 'role',
      targetId: data.role,
      targetLabel: roleLabel(data.role),
      summary,
      before,
      after,
    })
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'permissions_change',
      target: roleLabel(data.role),
      details: summary,
    })
    return { ok: true }
  })

// ---------------------------------------------------------------------------
// Exceptions for one person (also temporary)
// ---------------------------------------------------------------------------

const exceptionInput = z.record(
  z.string().max(60),
  z.object({ mode: z.enum(['allow', 'deny']), until: z.string().max(40).optional() }),
)

/** Owner: exceptions for one person. `until` (ISO date) makes an exception temporary. */
export const savePersonPermissions = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ id: z.string().min(1).max(100), exceptions: exceptionInput }))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const [row] = await db.select().from(users).where(eq(users.id, data.id)).limit(1)
    if (!row || !hasPanelRole(row.roles)) return { ok: false, error: 'Nie ma takiego konta.' }
    return applyPersonExceptions(row, data.exceptions, context)
  })

/** Owner: undoes one change from the history (restores the value from before it). */
export const undoPermissionChange = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ id: z.string().min(1).max(60) }))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const list = await readHistory()
    const entry = list.find((item) => item.id === data.id)
    if (!entry) return { ok: false, error: 'Nie znaleziono tej zmiany.' }
    if (entry.undone) return { ok: false, error: 'Ta zmiana została już cofnięta.' }
    if (entry.scope === 'role') {
      const current = (await readDenials())[entry.targetId] ?? []
      await writeRoleList(entry.targetId, Array.isArray(entry.before) ? (entry.before as string[]) : [])
      await pushHistory({
        by: context.identity,
        scope: 'role',
        targetId: entry.targetId,
        targetLabel: entry.targetLabel,
        summary: `cofnięcie zmiany z ${entry.at.slice(0, 16).replace('T', ' ')}`,
        before: current,
        after: entry.before,
      })
    } else {
      const current = parseExceptions(await readSetting(permUserKey(entry.targetId)))
      await writePerson(entry.targetId, parseExceptions(JSON.stringify(entry.before ?? {})))
      await pushHistory({
        by: context.identity,
        scope: 'person',
        targetId: entry.targetId,
        targetLabel: entry.targetLabel,
        summary: `cofnięcie zmiany z ${entry.at.slice(0, 16).replace('T', ' ')}`,
        before: current,
        after: entry.before,
      })
    }
    const fresh = await readHistory()
    await writeSetting(
      PERM_HISTORY_KEY,
      JSON.stringify(fresh.map((item) => (item.id === data.id ? { ...item, undone: true } : item))),
    )
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'permissions_change',
      target: entry.targetLabel,
      details: `Cofnięto zmianę: ${entry.summary}`,
    })
    return { ok: true }
  })

// ---------------------------------------------------------------------------
// Account preview (what this person can do)
// ---------------------------------------------------------------------------

export type AccountPreview = {
  email: string
  roles: string[]
  locked: boolean
  lockedReason: string | null
  suspendedUntil: string | null
  mustChangePassword: boolean
  lastLoginAt: string | null
  ipRules: string
  permissions: { key: string; label: string; group: string; allowed: boolean; source: Resolution['source']; until?: string }[]
}

/** Owner: a read-only look at what an account can do, and why. It does not sign in as that person. */
export const previewAccount = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ id: z.string().min(1).max(100) }))
  .handler(async ({ data }): Promise<AccountPreview | null> => {
    const [row] = await db.select().from(users).where(eq(users.id, data.id)).limit(1)
    if (!row) return null
    const denials = await readDenials()
    const exceptions = parseExceptions(await readSetting(permUserKey(row.id)))
    const owner = isSuperAdmin(row.email, row.roles)
    const roleIps = (await Promise.all(row.roles.map((role) => readSetting(roleIpKey(role))))).filter(Boolean).join('\n')
    return {
      email: row.email,
      roles: row.roles,
      locked: row.locked,
      lockedReason: row.lockedReason,
      suspendedUntil: row.frozenUntil && row.frozenUntil.getTime() > Date.now() ? row.frozenUntil.toISOString() : null,
      mustChangePassword: row.mustChangePassword,
      lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
      ipRules: roleIps,
      permissions: PERMISSIONS.filter((p) => owner || row.roles.some((role) => p.roles.includes(role))).map((p) => {
        const result = resolvePermission(p.key, { roles: row.roles, isOwner: owner, denials, exceptions })
        return { key: p.key, label: p.label, group: p.group, allowed: result.allowed, source: result.source, until: result.until }
      }),
    }
  })

// ---------------------------------------------------------------------------
// Addresses allowed for a role
// ---------------------------------------------------------------------------

/** Owner: addresses (one per line, IP or CIDR) from which a role may sign in. Empty = from anywhere. */
export const saveRoleIps = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ role: z.string().max(60), rules: z.string().max(4000) }))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    if (!PERMISSION_ROLES.some((r) => r.role === data.role)) return { ok: false, error: 'Nieznana rola.' }
    const lines = data.rules
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (lines.length > 60) return { ok: false, error: 'Najwyżej 60 reguł na rolę.' }
    const bad = lines.find((line) => !isValidRule(line))
    if (bad) return { ok: false, error: `Nieprawidłowy adres lub zakres: ${bad}` }
    if (lines.length) await writeSetting(roleIpKey(data.role), lines.join('\n'))
    else await clearSetting(roleIpKey(data.role))
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'permissions_change',
      target: roleLabel(data.role),
      details: lines.length ? `Dozwolone adresy logowania: ${lines.join(', ')}` : 'Zdjęto ograniczenie adresów logowania',
    })
    return { ok: true }
  })
