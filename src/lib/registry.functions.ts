import { createMiddleware, createServerFn } from '@tanstack/react-start'
import { admin, getUser } from '@netlify/identity'
import { and, asc, desc, eq, ne, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import {
  auditLog,
  practitioners,
  type Practitioner,
} from '../../db/schema'
import {
  MANAGEMENT_COOLDOWN_SECONDS,
  PESEL_MAX_LENGTH,
  PROFESSIONS,
  ROLE_ADMIN,
  ROLE_MANAGEMENT,
  isParamedic,
  pwzFromPesel,
  type AuditAction,
  type PublicEntry,
} from './registry'

function toPublic(row: Practitioner): PublicEntry {
  return {
    pwz: row.pwz,
    firstName: row.firstName,
    lastName: row.lastName,
    profession: row.profession,
    specialization:
      isParamedic(row.profession) ? 'nd.' : row.specialization || 'brak',
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
      // A digits-only query can be a PESEL (any length) or a 7-digit PWZ.
      const rows = await db
        .select()
        .from(practitioners)
        .where(or(eq(practitioners.pesel, q), eq(practitioners.pwz, q)))
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
        or(
          sql`lower(${practitioners.firstName} || ' ' || ${practitioners.lastName}) = ${needle}`,
          sql`lower(${practitioners.lastName} || ' ' || ${practitioners.firstName}) = ${needle}`,
        ),
      )
      .orderBy(asc(practitioners.lastName))
    return { status: 'ok', mode: 'name', entries: rows.map(toPublic) }
  })

/** Lets `admin` and `kierownictwo` through; exposes who they are and whether they are admin. */
const requireStaff = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const user = await getUser()
    const roles = user?.roles ?? []
    const isAdmin = roles.includes(ROLE_ADMIN)
    if (!user || (!isAdmin && !roles.includes(ROLE_MANAGEMENT))) {
      throw new Error('Brak uprawnień')
    }
    const identity = (user.email ?? user.id).toLowerCase()
    return next({ context: { user, isAdmin, identity } })
  },
)

/** Admin only (e.g. deleting entries). `kierownictwo` is deliberately not accepted. */
const requireAdmin = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const user = await getUser()
    if (!user?.roles?.includes(ROLE_ADMIN)) {
      throw new Error('Brak uprawnień administratora')
    }
    const identity = (user.email ?? user.id).toLowerCase()
    return next({ context: { user, identity } })
  },
)

/** Best-effort audit trail: a logging failure must never undo or block the action itself. */
async function logEvent(entry: {
  actor: string
  actorRole: string
  action: AuditAction
  target?: string
  details?: string
}) {
  try {
    await db.insert(auditLog).values(entry)
  } catch (error) {
    console.error('Nie udało się zapisać w dzienniku zdarzeń', error)
  }
}

/** Seconds a `kierownictwo` account still has to wait before adding another entry. */
async function cooldownLeft(identity: string): Promise<number> {
  // Computed in SQL so both timestamps use the database clock and time zone.
  const [last] = await db
    .select({
      secondsAgo: sql<string>`extract(epoch from (now() - ${practitioners.createdAt}))`,
    })
    .from(practitioners)
    .where(eq(practitioners.createdBy, identity))
    .orderBy(desc(practitioners.createdAt))
    .limit(1)
  if (!last) return 0
  const left = MANAGEMENT_COOLDOWN_SECONDS - Number(last.secondsAgo)
  return left > 0 ? Math.ceil(left) : 0
}

export const getCooldown = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(async ({ context }) => ({
    secondsLeft: context.isAdmin ? 0 : await cooldownLeft(context.identity),
  }))

export const listPractitioners = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(practitioners)
      .orderBy(desc(practitioners.createdAt))
    return rows.map((row) => ({
      id: row.id,
      // PESEL is only ever sent to admins.
      pesel: context.isAdmin ? row.pesel : null,
      // Raw value (or null) so the admin edit form can be prefilled.
      rawSpecialization: row.specialization,
      ...toPublic(row),
    }))
  })

const practitionerInput = z
  .object({
    pesel: z
      .string()
      .trim()
      .min(1, 'PESEL nie może być pusty')
      .max(PESEL_MAX_LENGTH, `PESEL może mieć najwyżej ${PESEL_MAX_LENGTH} cyfr`)
      .regex(/^\d+$/, 'PESEL może składać się tylko z cyfr'),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    profession: z.enum(PROFESSIONS),
    specialization: z.string().trim().max(160).optional(),
  })
  .transform((value) => ({
    ...value,
    specialization:
      isParamedic(value.profession) ? null : value.specialization || null,
  }))

export type AddResult =
  | { ok: true; pwz: string }
  | { ok: false; error: string; secondsLeft?: number }

export const addPractitioner = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator(practitionerInput)
  .handler(async ({ data, context }): Promise<AddResult> => {
    if (!context.isAdmin) {
      const secondsLeft = await cooldownLeft(context.identity)
      if (secondsLeft > 0) {
        return {
          ok: false,
          secondsLeft,
          error: 'Kierownictwo może dodać jedną osobę na 5 minut. Spróbuj ponownie później.',
        }
      }
    }
    const pwz = pwzFromPesel(data.pesel)
    const [clash] = await db
      .select({ pesel: practitioners.pesel, pwz: practitioners.pwz })
      .from(practitioners)
      .where(or(eq(practitioners.pesel, data.pesel), eq(practitioners.pwz, pwz)))
      .limit(1)
    if (clash) {
      return {
        ok: false,
        error:
          clash.pesel === data.pesel
            ? 'Osoba o tym numerze PESEL jest już w rejestrze.'
            : `Numer PWZ ${pwz} jest już przypisany do innej osoby.`,
      }
    }
    await db
      .insert(practitioners)
      .values({ ...data, pwz, createdBy: context.identity })
    await logEvent({
      actor: context.identity,
      actorRole: context.isAdmin ? ROLE_ADMIN : ROLE_MANAGEMENT,
      action: 'add',
      target: `${data.firstName} ${data.lastName} (PWZ ${pwz})`,
      details: [
        `Zawód: ${data.profession}`,
        data.specialization ? `specjalizacja: ${data.specialization}` : null,
      ]
        .filter(Boolean)
        .join(', '),
    })
    return { ok: true, pwz }
  })

const updateInput = z.object({
  id: z.number().int().positive(),
  pesel: z
    .string()
    .trim()
    .min(1, 'PESEL nie może być pusty')
    .max(PESEL_MAX_LENGTH, `PESEL może mieć najwyżej ${PESEL_MAX_LENGTH} cyfr`)
    .regex(/^\d+$/, 'PESEL może składać się tylko z cyfr'),
  pwz: z
    .string()
    .trim()
    .regex(/^\d{7}$/, 'Numer PWZ musi składać się z 7 cyfr'),
  specialization: z.string().trim().max(160).optional(),
})

export type UpdateResult = { ok: true } | { ok: false; error: string }

/** Admin only: change PESEL, set PWZ by hand and edit the specialization of an existing entry. */
export const updatePractitioner = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(updateInput)
  .handler(async ({ data, context }): Promise<UpdateResult> => {
    const [existing] = await db
      .select()
      .from(practitioners)
      .where(eq(practitioners.id, data.id))
      .limit(1)
    if (!existing) {
      return { ok: false, error: 'Nie znaleziono wpisu (mógł zostać usunięty).' }
    }
    const [clash] = await db
      .select({ pesel: practitioners.pesel })
      .from(practitioners)
      .where(
        and(
          ne(practitioners.id, data.id),
          or(eq(practitioners.pesel, data.pesel), eq(practitioners.pwz, data.pwz)),
        ),
      )
      .limit(1)
    if (clash) {
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
      .set({ pesel: data.pesel, pwz: data.pwz, specialization })
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
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'update',
      target: `${existing.firstName} ${existing.lastName} (PWZ ${data.pwz})`,
      details: changes.length ? changes.join('; ') : 'bez zmian',
    })
    return { ok: true }
  })

export const deletePractitioner = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data, context }) => {
    const [existing] = await db
      .select()
      .from(practitioners)
      .where(eq(practitioners.id, data.id))
      .limit(1)
    await db.delete(practitioners).where(eq(practitioners.id, data.id))
    if (existing) {
      await logEvent({
        actor: context.identity,
        actorRole: ROLE_ADMIN,
        action: 'delete',
        target: `${existing.firstName} ${existing.lastName} (PWZ ${existing.pwz})`,
        details: `Zawód: ${existing.profession}`,
      })
    }
    return { ok: true }
  })

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

const managementInput = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Podaj poprawny adres e-mail')
    .max(200),
  password: z
    .string()
    .min(8, 'Hasło musi mieć co najmniej 8 znaków')
    .max(200),
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
