import { createServerFn } from '@tanstack/react-start'
import { admin } from '@netlify/identity'
import {
  and,
  asc,
  desc,
  eq,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import { auditLog, practitioners, type Practitioner } from '../../db/schema'
import { requireAdmin, requireStaff } from './auth-server'
import { IN_TRASH, insertPractitioner } from './practitioners-server'
import {
  ENTRY_STATUSES,
  ENTRY_STATUS_KEYS,
  ROLE_ADMIN,
  ROLE_MANAGEMENT,
  TRASH_RETENTION_DAYS,
  entryNumber,
  isParamedic,
  type EntryStatus,
  type PublicEntry,
} from './registry'
import { peselSchema, practitionerInput } from './schemas'
import { logEvent, lookupAllowed } from './security-server'

/** Rows that are not in the trash. */
const alive = isNull(practitioners.deletedAt)

function toStatus(value: string): EntryStatus {
  return value in ENTRY_STATUSES ? (value as EntryStatus) : 'active'
}

function toPublic(row: Practitioner): PublicEntry {
  return {
    pwz: row.pwz,
    firstName: row.firstName,
    lastName: row.lastName,
    profession: row.profession,
    specialization:
      isParamedic(row.profession) ? 'nd.' : row.specialization || 'brak',
    status: toStatus(row.status),
    entryNumber: entryNumber(row.id),
    entryDate: row.createdAt.toISOString(),
  }
}

const searchInput = z.object({ q: z.string().trim().min(1).max(120) })

export type SearchResult =
  | { status: 'ok'; mode: 'pesel' | 'pwz' | 'name'; entries: PublicEntry[] }
  | { status: 'invalid'; message: string }

export const searchRegistry = createServerFn({ method: 'GET' })
  .validator(searchInput)
  .handler(async ({ data }): Promise<SearchResult> => {
    const q = data.q.replace(/\s+/g, ' ')

    if (/^\d+$/.test(q)) {
      if (!(await lookupAllowed())) {
        return {
          status: 'invalid',
          message: 'Zbyt wiele zapytań. Spróbuj ponownie za minutę.',
        }
      }
      // A digits-only query can be a PESEL (any length) or a 7-digit PWZ.
      const rows = await db
        .select()
        .from(practitioners)
        .where(
          and(alive, or(eq(practitioners.pesel, q), eq(practitioners.pwz, q))),
        )
        .orderBy(asc(practitioners.lastName))
      return {
        status: 'ok',
        mode: q.length === 7 ? 'pwz' : 'pesel',
        entries: rows.map(toPublic),
      }
    }

    if (q.split(' ').length < 2) {
      return {
        status: 'invalid',
        message: 'Podaj pełne imię i nazwisko.',
      }
    }

    const needle = q.toLowerCase()
    const rows = await db
      .select()
      .from(practitioners)
      .where(
        and(
          alive,
          or(
            sql`lower(${practitioners.firstName} || ' ' || ${practitioners.lastName}) = ${needle}`,
            sql`lower(${practitioners.lastName} || ' ' || ${practitioners.firstName}) = ${needle}`,
          ),
        ),
      )
      .orderBy(asc(practitioners.lastName))
    return { status: 'ok', mode: 'name', entries: rows.map(toPublic) }
  })

// ---------------------------------------------------------------------------
// Registry entries
// ---------------------------------------------------------------------------

export const listPractitioners = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(async () => {
    const rows = await db
      .select()
      .from(practitioners)
      .where(alive)
      .orderBy(desc(practitioners.createdAt))
    return rows.map((row) => ({
      id: row.id,
      // PESEL is sent to staff only (admin and kierownictwo), never to the public.
      pesel: row.pesel,
      // Raw value (or null) so the admin edit form can be prefilled.
      rawSpecialization: row.specialization,
      createdBy: row.createdBy,
      ...toPublic(row),
    }))
  })

export type AddResult = { ok: true; pwz: string } | { ok: false; error: string }

/** Admin only: adds a person directly. `kierownictwo` submits a request instead (see requests.functions.ts). */
export const addPractitioner = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(practitionerInput)
  .handler(async ({ data, context }): Promise<AddResult> => {
    const result = await insertPractitioner(data, context.identity)
    if (!result.ok) return result
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'add',
      target: `${data.firstName} ${data.lastName} (PWZ ${result.pwz})`,
      details: [
        `Zawód: ${data.profession}`,
        data.specialization ? `specjalizacja: ${data.specialization}` : null,
      ]
        .filter(Boolean)
        .join(', '),
    })
    return result
  })

const updateInput = z.object({
  id: z.number().int().positive(),
  pesel: peselSchema,
  pwz: z
    .string()
    .trim()
    .regex(/^\d{7}$/, 'Numer PWZ musi składać się z 7 cyfr'),
  specialization: z.string().trim().max(160).optional(),
  status: z.enum(ENTRY_STATUS_KEYS),
})

export type UpdateResult = { ok: true } | { ok: false; error: string }

/** Admin only: change PESEL, set PWZ by hand, edit the specialization and the status of an existing entry. */
export const updatePractitioner = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(updateInput)
  .handler(async ({ data, context }): Promise<UpdateResult> => {
    const [existing] = await db
      .select()
      .from(practitioners)
      .where(and(eq(practitioners.id, data.id), alive))
      .limit(1)
    if (!existing) {
      return { ok: false, error: 'Nie znaleziono wpisu (mógł zostać usunięty).' }
    }
    const [clash] = await db
      .select({
        pesel: practitioners.pesel,
        deletedAt: practitioners.deletedAt,
      })
      .from(practitioners)
      .where(
        and(
          ne(practitioners.id, data.id),
          or(eq(practitioners.pesel, data.pesel), eq(practitioners.pwz, data.pwz)),
        ),
      )
      .limit(1)
    if (clash) {
      if (clash.deletedAt) return { ok: false, error: IN_TRASH }
      return {
        ok: false,
        error:
          clash.pesel === data.pesel
            ? 'Inna osoba ma już ten numer PESEL.'
            : `Numer PWZ ${data.pwz} jest już przypisany do innej osoby.`,
      }
    }
    // Paramedics never have a specialization (shown as "nd.").
    const specialization = isParamedic(existing.profession)
      ? null
      : data.specialization || null
    await db
      .update(practitioners)
      .set({
        pesel: data.pesel,
        pwz: data.pwz,
        specialization,
        status: data.status,
      })
      .where(eq(practitioners.id, data.id))

    const changes: string[] = []
    if (existing.pesel !== data.pesel) {
      changes.push(`PESEL: ${existing.pesel} → ${data.pesel}`)
    }
    if (existing.pwz !== data.pwz) {
      changes.push(`PWZ: ${existing.pwz} → ${data.pwz}`)
    }
    if ((existing.specialization ?? null) !== specialization) {
      changes.push(
        `specjalizacja: ${existing.specialization ?? 'brak'} → ${specialization ?? 'brak'}`,
      )
    }
    if (toStatus(existing.status) !== data.status) {
      changes.push(
        `status: ${ENTRY_STATUSES[toStatus(existing.status)]} → ${ENTRY_STATUSES[data.status]}`,
      )
    }
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'update',
      target: `${existing.firstName} ${existing.lastName} (PWZ ${data.pwz})`,
      details: changes.length ? changes.join('; ') : 'bez zmian',
    })
    return { ok: true }
  })

/** Admin only: moves an entry to the trash (it can be restored for TRASH_RETENTION_DAYS days). */
export const deletePractitioner = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data, context }) => {
    const [existing] = await db
      .select()
      .from(practitioners)
      .where(and(eq(practitioners.id, data.id), alive))
      .limit(1)
    if (!existing) return { ok: true }
    await db
      .update(practitioners)
      .set({ deletedAt: sql`now()` })
      .where(eq(practitioners.id, data.id))
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'delete',
      target: `${existing.firstName} ${existing.lastName} (PWZ ${existing.pwz})`,
      details: `Zawód: ${existing.profession}. Przeniesiono do kosza (${TRASH_RETENTION_DAYS} dni na przywrócenie)`,
    })
    return { ok: true }
  })

// ---------------------------------------------------------------------------
// Badges (staff only) and the public verification behind their QR code
// ---------------------------------------------------------------------------

/** Staff only: everything printed on a badge (including the PESEL). */
export const getBadge = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const [row] = await db
      .select()
      .from(practitioners)
      .where(and(eq(practitioners.id, data.id), alive))
      .limit(1)
    if (!row) return null
    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      pesel: row.pesel,
      pwz: row.pwz,
      profession: row.profession,
      status: toStatus(row.status),
      entryNumber: entryNumber(row.id),
    }
  })

export type VerifyResult =
  | {
      status: 'valid'
      firstName: string
      lastName: string
      profession: string
      pwz: string
    }
  | { status: 'suspended' | 'inactive' | 'not_found' | 'limited'; pwz: string }

/** Public: is the entry behind a badge real and current? Only active entries are "valid". */
export const verifyEntry = createServerFn({ method: 'GET' })
  .validator(z.object({ pwz: z.string().regex(/^\d{7}$/) }))
  .handler(async ({ data }): Promise<VerifyResult> => {
    if (!(await lookupAllowed())) return { status: 'limited', pwz: data.pwz }
    const [row] = await db
      .select()
      .from(practitioners)
      .where(and(eq(practitioners.pwz, data.pwz), alive))
      .limit(1)
    if (!row) return { status: 'not_found', pwz: data.pwz }
    const status = toStatus(row.status)
    if (status === 'suspended') return { status: 'suspended', pwz: data.pwz }
    if (status === 'expired') return { status: 'inactive', pwz: data.pwz }
    return {
      status: 'valid',
      firstName: row.firstName,
      lastName: row.lastName,
      profession: row.profession,
      pwz: row.pwz,
    }
  })

// ---------------------------------------------------------------------------
// Trash
// ---------------------------------------------------------------------------

/** Admin only: entries in the trash. Entries older than the retention period are purged first. */
export const listTrash = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(async () => {
    await db
      .delete(practitioners)
      .where(
        and(
          isNotNull(practitioners.deletedAt),
          lt(
            practitioners.deletedAt,
            sql`now() - ${sql.raw(`interval '${TRASH_RETENTION_DAYS} days'`)}`,
          ),
        ),
      )
    const rows = await db
      .select()
      .from(practitioners)
      .where(isNotNull(practitioners.deletedAt))
      .orderBy(desc(practitioners.deletedAt))
    return rows.map((row) => {
      const deletedAt = row.deletedAt ?? new Date()
      const daysGone = Math.floor((Date.now() - deletedAt.getTime()) / 86_400_000)
      return {
        id: row.id,
        firstName: row.firstName,
        lastName: row.lastName,
        pwz: row.pwz,
        profession: row.profession,
        deletedAt: deletedAt.toISOString(),
        daysLeft: Math.max(0, TRASH_RETENTION_DAYS - daysGone),
      }
    })
  })

export const restorePractitioner = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data, context }) => {
    const [existing] = await db
      .select()
      .from(practitioners)
      .where(and(eq(practitioners.id, data.id), isNotNull(practitioners.deletedAt)))
      .limit(1)
    if (!existing) return { ok: false as const, error: 'Nie znaleziono wpisu w koszu.' }
    await db
      .update(practitioners)
      .set({ deletedAt: null })
      .where(eq(practitioners.id, data.id))
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'restore',
      target: `${existing.firstName} ${existing.lastName} (PWZ ${existing.pwz})`,
    })
    return { ok: true as const }
  })

/** Permanently deletes an entry that is already in the trash. */
export const purgePractitioner = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data, context }) => {
    const [existing] = await db
      .select()
      .from(practitioners)
      .where(and(eq(practitioners.id, data.id), isNotNull(practitioners.deletedAt)))
      .limit(1)
    if (!existing) return { ok: false as const, error: 'Nie znaleziono wpisu w koszu.' }
    await db.delete(practitioners).where(eq(practitioners.id, data.id))
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'purge',
      target: `${existing.firstName} ${existing.lastName} (PWZ ${existing.pwz})`,
    })
    return { ok: true as const }
  })

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/** Admin only: the audit log, newest first. */
export const listAuditLog = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(async () => {
    const rows = await db
      .select()
      .from(auditLog)
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(300)
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      actor: row.actor,
      actorRole: row.actorRole,
      action: row.action,
      target: row.target,
      details: row.details,
    }))
  })

// ---------------------------------------------------------------------------
// kierownictwo accounts (Netlify Identity)
// ---------------------------------------------------------------------------

/** Admin only: Identity accounts that have the `kierownictwo` role (and are not admins). */
export const listManagement = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(async () => {
    const found = new Map<string, { id: string; email: string }>()
    const perPage = 100
    for (let page = 1; page <= 20; page++) {
      const users = await admin.listUsers({ page, perPage })
      for (const user of users) {
        const roles = user.roles ?? []
        if (roles.includes(ROLE_MANAGEMENT) && !roles.includes(ROLE_ADMIN)) {
          found.set(user.id, { id: user.id, email: user.email ?? user.id })
        }
      }
      if (users.length < perPage) break
    }
    return [...found.values()].sort((a, b) => a.email.localeCompare(b.email))
  })

export type DeleteManagementResult = { ok: true } | { ok: false; error: string }

/** Admin only: permanently deletes a `kierownictwo` account. Admin accounts are refused. */
export const deleteManagement = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(z.object({ id: z.string().min(1).max(100) }))
  .handler(async ({ data, context }): Promise<DeleteManagementResult> => {
    let email = data.id
    try {
      const target = await admin.getUser(data.id)
      const roles = target.roles ?? []
      if (!roles.includes(ROLE_MANAGEMENT) || roles.includes(ROLE_ADMIN)) {
        return { ok: false, error: 'To konto nie jest kontem kierownictwa.' }
      }
      email = target.email ?? target.id
      await admin.deleteUser(data.id)
    } catch {
      return { ok: false, error: 'Nie udało się usunąć konta.' }
    }
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'delete_management',
      target: email,
      details: `Rola: ${ROLE_MANAGEMENT}`,
    })
    return { ok: true }
  })

const passwordSchema = z
  .string()
  .min(8, 'Hasło musi mieć co najmniej 8 znaków')
  .max(200)

export type SetPasswordResult = { ok: true } | { ok: false; error: string }

/** Admin only: sets a new password for a `kierownictwo` account (admin accounts are refused). */
export const setManagementPassword = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(
    z.object({ id: z.string().min(1).max(100), password: passwordSchema }),
  )
  .handler(async ({ data, context }): Promise<SetPasswordResult> => {
    let email = data.id
    try {
      const target = await admin.getUser(data.id)
      const roles = target.roles ?? []
      if (!roles.includes(ROLE_MANAGEMENT) || roles.includes(ROLE_ADMIN)) {
        return { ok: false, error: 'To konto nie jest kontem kierownictwa.' }
      }
      email = target.email ?? target.id
      await admin.updateUser(data.id, { password: data.password })
    } catch {
      return { ok: false, error: 'Nie udało się ustawić hasła.' }
    }
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'reset_password',
      target: email,
      details: 'Hasło ustawione przez administratora',
    })
    return { ok: true }
  })

const managementInput = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Podaj poprawny adres e-mail')
    .max(200),
  password: passwordSchema,
})

export type AddManagementResult =
  | { ok: true; email: string }
  | { ok: false; error: string }

/** Admin only: creates a Netlify Identity account that has the `kierownictwo` role. */
export const addManagement = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(managementInput)
  .handler(async ({ data, context }): Promise<AddManagementResult> => {
    let userId: string
    let hasRole: boolean
    try {
      const user = await admin.createUser({
        email: data.email,
        password: data.password,
        data: { app_metadata: { roles: [ROLE_MANAGEMENT] } },
      })
      userId = user.id
      hasRole = user.roles?.includes(ROLE_MANAGEMENT) ?? false
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      return {
        ok: false,
        error: /already|exist|registered|taken/i.test(message)
          ? 'Konto z tym adresem e-mail już istnieje.'
          : 'Nie udało się utworzyć konta. Spróbuj ponownie.',
      }
    }
    if (!hasRole) {
      // Make sure the role is stored even if createUser ignored app_metadata.
      try {
        await admin.updateUser(userId, {
          app_metadata: { roles: [ROLE_MANAGEMENT] },
        })
      } catch {
        return {
          ok: false,
          error: `Konto ${data.email} zostało utworzone, ale nie udało się nadać roli. Nadaj rolę ${ROLE_MANAGEMENT} w Netlify Identity.`,
        }
      }
    }
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'add_management',
      target: data.email,
      details: `Rola: ${ROLE_MANAGEMENT}`,
    })
    return { ok: true, email: data.email }
  })
