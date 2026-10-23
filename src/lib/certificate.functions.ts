import { createServerFn } from '@tanstack/react-start'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import { practitioners, settings } from '../../db/schema'
import { requireAdmin } from './auth-server'
import {
  ENTRY_STATUSES,
  ROLE_ADMIN,
  entryNumber,
  isParamedic,
  type EntryStatus,
} from './registry'
import { logEvent, lookupAllowed } from './security-server'

const SEAL_KEY = 'seal'

/** PNG / JPEG / WebP only (never SVG, which can carry scripts), up to ~500 KB. */
const sealSchema = z
  .string()
  .max(700_000, 'Obraz jest zbyt duży (maksymalnie ok. 500 KB)')
  .regex(
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/,
    'Wgraj obraz PNG, JPEG lub WebP',
  )

async function readSeal(): Promise<string | null> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, SEAL_KEY))
    .limit(1)
  return row?.value ?? null
}

/** Admin only: the currently uploaded seal (for the preview in the panel). */
export const getSeal = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(async () => ({ seal: await readSeal() }))

export type SealResult = { ok: true } | { ok: false; error: string }

export const saveSeal = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(z.object({ dataUrl: sealSchema }))
  .handler(async ({ data, context }): Promise<SealResult> => {
    await db
      .insert(settings)
      .values({ key: SEAL_KEY, value: data.dataUrl })
      .onConflictDoUpdate({ target: settings.key, set: { value: data.dataUrl } })
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'seal',
      details: 'Wgrano nową pieczęć',
    })
    return { ok: true }
  })

export const removeSeal = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .handler(async ({ context }): Promise<SealResult> => {
    await db.delete(settings).where(eq(settings.key, SEAL_KEY))
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'seal',
      details: 'Usunięto pieczęć',
    })
    return { ok: true }
  })

export type CertificateResult =
  | {
      status: 'ok'
      entry: {
        firstName: string
        lastName: string
        pwz: string
        profession: string
        /** null for paramedics and when no specialization is set. */
        specialization: string | null
        entryNumber: string
        entryDate: string
      }
      seal: string | null
      issuedAt: string
    }
  | { status: 'not_found' }
  | { status: 'unavailable'; entryStatus: EntryStatus }
  | { status: 'limited' }

/**
 * Public: data for the printable certificate. Only active entries get one, and the
 * lookup counts towards the same per-IP limit as the numeric searches.
 */
export const getCertificate = createServerFn({ method: 'GET' })
  .validator(z.object({ pwz: z.string().regex(/^\d{7}$/) }))
  .handler(async ({ data }): Promise<CertificateResult> => {
    if (!(await lookupAllowed())) return { status: 'limited' }
    const [row] = await db
      .select()
      .from(practitioners)
      .where(and(eq(practitioners.pwz, data.pwz), isNull(practitioners.deletedAt)))
      .limit(1)
    if (!row) return { status: 'not_found' }
    const entryStatus: EntryStatus =
      row.status in ENTRY_STATUSES ? (row.status as EntryStatus) : 'active'
    if (entryStatus !== 'active') return { status: 'unavailable', entryStatus }
    return {
      status: 'ok',
      entry: {
        firstName: row.firstName,
        lastName: row.lastName,
        pwz: row.pwz,
        profession: row.profession,
        specialization: isParamedic(row.profession) ? null : row.specialization,
        entryNumber: entryNumber(row.id),
        entryDate: row.createdAt.toISOString(),
      },
      seal: await readSeal(),
      issuedAt: new Date().toISOString(),
    }
  })
