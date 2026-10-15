import { createMiddleware, createServerFn } from '@tanstack/react-start'
import { getUser } from '@netlify/identity'
import { asc, desc, eq, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import { practitioners, type Practitioner } from '../../db/schema'
import {
  MANAGEMENT_COOLDOWN_SECONDS,
  PESEL_MAX_LENGTH,
  PROFESSIONS,
  ROLE_ADMIN,
  ROLE_MANAGEMENT,
  isParamedic,
  pwzFromPesel,
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
    return next({ context: { user } })
  },
)

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
    return { ok: true, pwz }
  })

export const deletePractitioner = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    await db.delete(practitioners).where(eq(practitioners.id, data.id))
    return { ok: true }
  })
