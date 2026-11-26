/** Server-only: reads the owner's permission switches and decides what a signed-in person may do. */
import { inArray } from 'drizzle-orm'

import { db } from '../../db'
import { settings } from '../../db/schema'
import {
  PERMISSIONS,
  deniedKeys,
  permissionByKey,
  resolvePermission,
  type PersonExceptions,
  type Resolution,
  type RoleDenials,
} from './permissions'

export const PERM_ROLES_KEY = 'perm_roles'
export const permUserKey = (id: string) => `perm_user_${id}`
export const PERM_HISTORY_KEY = 'perm_history'
export const roleIpKey = (role: string) => `ip_role_${role}`

export function parseDenials(raw: string | null | undefined): RoleDenials {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const result: RoleDenials = {}
    for (const [role, keys] of Object.entries(value)) {
      if (Array.isArray(keys)) result[role] = keys.filter((k): k is string => typeof k === 'string' && !!permissionByKey(k))
    }
    return result
  } catch {
    return {}
  }
}

export function parseExceptions(raw: string | null | undefined): PersonExceptions {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as Record<string, { mode?: unknown; until?: unknown }>
    const result: PersonExceptions = {}
    for (const [key, item] of Object.entries(value)) {
      if (!permissionByKey(key) || (item?.mode !== 'allow' && item?.mode !== 'deny')) continue
      result[key] = { mode: item.mode, ...(typeof item.until === 'string' && item.until ? { until: item.until } : {}) }
    }
    return result
  } catch {
    return {}
  }
}

/** The role switches and the person's exceptions (one query). A failed read means "no switches". */
export async function loadPermissionConfig(userId: string): Promise<{ denials: RoleDenials; exceptions: PersonExceptions }> {
  try {
    const rows = await db
      .select()
      .from(settings)
      .where(inArray(settings.key, [PERM_ROLES_KEY, permUserKey(userId)]))
    const get = (key: string) => rows.find((row) => row.key === key)?.value
    return { denials: parseDenials(get(PERM_ROLES_KEY)), exceptions: parseExceptions(get(permUserKey(userId))) }
  } catch (error) {
    console.error('Nie udało się wczytać przełączników uprawnień', error)
    return { denials: {}, exceptions: {} }
  }
}

type Person = { id: string; roles: string[]; isSuperAdmin?: boolean }

export async function checkPermission(person: Person, key: string): Promise<Resolution> {
  const config = await loadPermissionConfig(person.id)
  return resolvePermission(key, { roles: person.roles, isOwner: !!person.isSuperAdmin, ...config })
}

/** Throws a Polish error when the person may not do this. */
export async function assertPermission(person: Person, key: string): Promise<void> {
  if (!(await checkPermission(person, key)).allowed) {
    const def = permissionByKey(key)
    throw new Error(`Właściciel wyłączył to uprawnienie${def ? `: ${def.label}` : ''}.`)
  }
}

/** The permission keys switched off for this person (used by the panel to hide buttons). */
export async function deniedFor(person: Person): Promise<string[]> {
  const config = await loadPermissionConfig(person.id)
  return deniedKeys({ roles: person.roles, isOwner: !!person.isSuperAdmin, ...config })
}

export { PERMISSIONS }
