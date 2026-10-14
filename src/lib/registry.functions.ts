import { createMiddleware, createServerFn } from '@tanstack/react-start'
import { getUser } from '@netlify/identity'
import { asc, desc, eq, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import { practitioners, type Practitioner } from '../../db/schema'
import {
  PARAMEDIC,
  PROFESSIONS,
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
      row.profession === PARAMEDIC ? 'nd.' : row.specialization || 'brak',
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
      if (q.length === 11) {
        const rows = await db
          .select()
          .from(practitioners)
          .where(eq(practitioners.pesel, q))
        return { status: 'ok', mode: 'pesel', entries: rows.map(toPublic) }
      }
      if (q.length === 7) {
        const rows = await db
          .select()
          .from(practitioners)
          .where(eq(practitioners.pwz, q))
        return { status: 'ok', mode: 'pwz', entries: rows.map(toPublic) }
      }
      return {
        status: 'invalid',
        message:
          'Numer PESEL składa się z 11 cyfr, a numer PWZ z 7 cyfr.',
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

const requireAdmin = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const user = await getUser()
    if (!user?.roles?.includes('admin')) {
      throw new Error('Brak uprawnień administratora')
    }
    return next({ context: { user } })
  },
)

export const listPractitioners = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(async () => {
    const rows = await db
      .select()
      .from(practitioners)
      .orderBy(desc(practitioners.createdAt))
    return rows.map((row) => ({
      id: row.id,
      pesel: row.pesel,
      ...toPublic(row),
    }))
  })

const practitionerInput = z
  .object({
    pesel: z.string().trim().regex(/^\d{11}$/, 'PESEL musi mieć 11 cyfr'),
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    profession: z.enum(PROFESSIONS),
    specialization: z.string().trim().max(160).optional(),
  })
  .transform((value) => ({
    ...value,
    specialization:
      value.profession === PARAMEDIC ? null : value.specialization || null,
  }))

export type AddResult = { ok: true; pwz: string } | { ok: false; error: string }

export const addPractitioner = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(practitionerInput)
  .handler(async ({ data }): Promise<AddResult> => {
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
    await db.insert(practitioners).values({ ...data, pwz })
    return { ok: true, pwz }
  })

export const deletePractitioner = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    await db.delete(practitioners).where(eq(practitioners.id, data.id))
    return { ok: true }
  })
