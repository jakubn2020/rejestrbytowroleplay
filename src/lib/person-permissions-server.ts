/** Server-only: the permission history and the per-person exceptions, shared by the owner's and the admins' panels. */
import { permissionByKey, roleHasByDefault, type PersonExceptions } from './permissions'
import { PERM_HISTORY_KEY, parseExceptions, permUserKey } from './permissions-server'
import { ROLE_ADMIN } from './registry'
import { logEvent } from './security-server'
import { isSuperAdmin } from './session-server'
import { clearSetting, readSetting, writeSetting } from './site-settings-server'

export type PermissionChange = {
  id: string
  at: string
  by: string
  scope: 'role' | 'person'
  targetId: string
  targetLabel: string
  summary: string
  /** Value before and after: a list of keys for a role, the exceptions for a person. */
  before: unknown
  after: unknown
  undone: boolean
}

export async function readHistory(): Promise<PermissionChange[]> {
  try {
    const raw = await readSetting(PERM_HISTORY_KEY)
    const value: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(value) ? (value as PermissionChange[]) : []
  } catch {
    return []
  }
}

export async function pushHistory(entry: Omit<PermissionChange, 'id' | 'at' | 'undone'>): Promise<void> {
  const list = await readHistory()
  list.unshift({ ...entry, id: crypto.randomUUID(), at: new Date().toISOString(), undone: false })
  await writeSetting(PERM_HISTORY_KEY, JSON.stringify(list.slice(0, 80)))
}

export async function writePerson(id: string, exceptions: PersonExceptions): Promise<void> {
  if (Object.keys(exceptions).length) await writeSetting(permUserKey(id), JSON.stringify(exceptions))
  else await clearSetting(permUserKey(id))
}

/**
 * Validates and saves the exceptions of one person (history and audit trail included).
 * "Allow" only works for permissions one of the person's roles has by default, so nobody can be given more than
 * their role offers. Used by the owner (any panel account) and by admins (examiners and moderators only).
 */
export async function applyPersonExceptions(
  row: { id: string; email: string; roles: string[] },
  exceptions: Record<string, { mode: 'allow' | 'deny'; until?: string }>,
  actor: { identity: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (isSuperAdmin(row.email, row.roles)) return { ok: false, error: 'Uprawnień właściciela nie da się ograniczyć.' }
  const cleaned: PersonExceptions = {}
  for (const [key, item] of Object.entries(exceptions)) {
    if (!permissionByKey(key)) continue
    if (item.mode === 'allow' && !row.roles.some((role) => roleHasByDefault(role, key))) continue
    let until: string | undefined
    if (item.until) {
      const time = Date.parse(item.until)
      if (!Number.isFinite(time)) return { ok: false, error: 'Nieprawidłowa data końca wyjątku.' }
      if (time <= Date.now()) return { ok: false, error: 'Data końca wyjątku musi być w przyszłości.' }
      if (time > Date.now() + 366 * 86_400_000) return { ok: false, error: 'Wyjątek może trwać najwyżej rok.' }
      until = new Date(time).toISOString()
    }
    cleaned[key] = { mode: item.mode, ...(until ? { until } : {}) }
  }
  const before = parseExceptions(await readSetting(permUserKey(row.id)))
  if (JSON.stringify(before) === JSON.stringify(cleaned)) return { ok: true }
  await writePerson(row.id, cleaned)
  const describe = (list: PersonExceptions) =>
    Object.entries(list)
      .map(([k, v]) => `${permissionByKey(k)?.label ?? k}: ${v.mode === 'deny' ? 'zablokowane' : 'dozwolone'}${v.until ? ` do ${v.until.slice(0, 10)}` : ''}`)
      .join(', ') || 'brak wyjątków'
  const summary = `było: ${describe(before)}; jest: ${describe(cleaned)}`
  await pushHistory({
    by: actor.identity,
    scope: 'person',
    targetId: row.id,
    targetLabel: row.email,
    summary,
    before,
    after: cleaned,
  })
  await logEvent({
    actor: actor.identity,
    actorRole: ROLE_ADMIN,
    action: 'permissions_change',
    target: row.email,
    details: summary,
  })
  return { ok: true }
}
