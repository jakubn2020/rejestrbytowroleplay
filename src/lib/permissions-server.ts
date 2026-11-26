/** Server-only: works out whether an account may do something, from the owner's settings. */
import { inArray } from 'drizzle-orm'

import { db } from '../../db'
import { settings } from '../../db/schema'
import {
  PERMISSIONS,
  permKey,
  permissionLabel,
  type PermissionKey,
  type ResolvedPermission,
  type UserOverride,
} from './permissions'
import { isSuperAdmin } from './session-server'

type Subject = { id: string; email: string; roles: string[] }

function parseDenied(raw: string | undefined): Set<string> {
  if (!raw) return new Set()
  try {
    const value: unknown = JSON.parse(raw)
    return new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

export function parseUserOverrides(raw: string | undefined | null): Record<string, UserOverride> {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as Record<string, { allow?: unknown; until?: unknown }>
    const result: Record<string, UserOverride> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry?.allow === 'boolean') {
        result[key] = { allow: entry.allow, ...(typeof entry.until === 'string' ? { until: entry.until } : {}) }
      }
    }
    return result
  } catch {
    return {}
  }
}

/** Every permission of one account, with where the decision came from. The owner may always do everything. */
export async function resolveAll(subject: Subject): Promise<ResolvedPermission[]> {
  const owner = isSuperAdmin(subject.email, subject.roles)
  const keys = [permKey.user(subject.id), ...subject.roles.map(permKey.role)]
  const rows = await db.select().from(settings).where(inArray(settings.key, keys))
  const value = (key: string) => rows.find((row) => row.key === key)?.value
  const overrides = parseUserOverrides(value(permKey.user(subject.id)))
  const now = Date.now()

  return PERMISSIONS.map((permission): ResolvedPermission => {
    const base = { key: permission.key, label: permission.label }
    if (owner) return { ...base, allowed: true, source: 'owner' }
    const relevant = subject.roles.filter((role) => (permission.roles as readonly string[]).includes(role))
    if (relevant.length === 0) return { ...base, allowed: true, source: 'n/a' }

    const override = overrides[permission.key]
    if (override && (!override.until || new Date(override.until).getTime() > now)) {
      return { ...base, allowed: override.allow, source: 'person', ...(override.until ? { until: override.until } : {}) }
    }
    const denied = relevant.every((role) => parseDenied(value(permKey.role(role))).has(permission.key))
    return { ...base, allowed: !denied, source: denied ? 'role' : 'default' }
  })
}

/** A Polish message when this account may not do it, otherwise null. */
export async function permissionDenied(subject: Subject, key: PermissionKey): Promise<string | null> {
  try {
    const found = (await resolveAll(subject)).find((p) => p.key === key)
    if (found && !found.allowed) {
      return `Właściciel wyłączył to uprawnienie: ${permissionLabel(key).toLowerCase()}.`
    }
    return null
  } catch (error) {
    // A failed read must never lock people out.
    console.error('Nie udało się sprawdzić uprawnień', error)
    return null
  }
}

/** Throws when the account may not do it (for handlers that do not return a typed error). */
export async function assertPermission(subject: Subject, key: PermissionKey): Promise<void> {
  const message = await permissionDenied(subject, key)
  if (message) throw new Error(message)
}
