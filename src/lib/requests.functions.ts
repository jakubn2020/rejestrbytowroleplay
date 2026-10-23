import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import { entryRequests } from '../../db/schema'
import { requireAdmin, requireStaff } from './auth-server'
import { findClash, insertPractitioner } from './practitioners-server'
import {
  ROLE_ADMIN,
  ROLE_MANAGEMENT,
  pwzFromPesel,
  toRequestStatus,
  type RequestStatus,
} from './registry'
import { practitionerInput } from './schemas'
import {
  claimCooldown,
  cooldownLeft,
  logEvent,
  releaseCooldown,
} from './security-server'

const COOLDOWN_MESSAGE =
  'Kierownictwo może złożyć jeden wniosek na 5 minut. Spróbuj ponownie później.'

/** Screenshot of the message (PNG / JPEG / WebP, never SVG), up to ~1.5 MB after compression. */
const proofSchema = z
  .string()
  .max(2_000_000, 'Zrzut ekranu jest zbyt duży')
  .regex(
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/,
    'Dołącz zrzut ekranu jako obraz PNG, JPEG lub WebP',
  )

const submitInput = z.object({
  person: practitionerInput,
  proof: proofSchema,
})

export type SubmitResult =
  | { ok: true }
  | { ok: false; error: string; secondsLeft?: number }

export const getCooldown = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(async ({ context }) => ({
    secondsLeft: context.isAdmin ? 0 : await cooldownLeft(context.identity),
  }))

/**
 * Kierownictwo: asks for a new entry. The request needs the PESEL and a screenshot
 * of the message in which the person says they want the entry; an admin decides.
 */
export const submitRequest = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator(submitInput)
  .handler(async ({ data, context }): Promise<SubmitResult> => {
    if (context.isAdmin) {
      return {
        ok: false,
        error: 'Administrator dodaje osoby bezpośrednio, bez wniosku.',
      }
    }
    const { person, proof } = data
    const secondsLeft = await cooldownLeft(context.identity)
    if (secondsLeft > 0) return { ok: false, secondsLeft, error: COOLDOWN_MESSAGE }

    const clash = await findClash(person.pesel, pwzFromPesel(person.pesel))
    if (clash) return { ok: false, error: clash }

    const [pending] = await db
      .select({ id: entryRequests.id })
      .from(entryRequests)
      .where(
        and(
          eq(entryRequests.pesel, person.pesel),
          eq(entryRequests.status, 'pending'),
        ),
      )
      .limit(1)
    if (pending) {
      return {
        ok: false,
        error: 'Wniosek dla tego numeru PESEL już oczekuje na decyzję.',
      }
    }

    if (!(await claimCooldown(context.identity))) {
      return {
        ok: false,
        secondsLeft: await cooldownLeft(context.identity),
        error: COOLDOWN_MESSAGE,
      }
    }
    try {
      await db.insert(entryRequests).values({
        requestedBy: context.identity,
        pesel: person.pesel,
        firstName: person.firstName,
        lastName: person.lastName,
        profession: person.profession,
        specialization: person.specialization,
        proof,
      })
    } catch (error) {
      console.error('Nie udało się zapisać wniosku', error)
      await releaseCooldown(context.identity)
      return { ok: false, error: 'Nie udało się zapisać wniosku. Spróbuj ponownie.' }
    }
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_MANAGEMENT,
      action: 'request_create',
      target: `${person.firstName} ${person.lastName} (PESEL ${person.pesel})`,
      details: `Zawód: ${person.profession}`,
    })
    return { ok: true }
  })

function toRow(row: typeof entryRequests.$inferSelect) {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    requestedBy: row.requestedBy,
    pesel: row.pesel,
    firstName: row.firstName,
    lastName: row.lastName,
    profession: row.profession,
    specialization: row.specialization,
    status: toRequestStatus(row.status),
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    note: row.note,
  }
}

export type RequestRow = ReturnType<typeof toRow>

/** The caller's own requests (without the screenshot), newest first. */
export const listMyRequests = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(async ({ context }): Promise<RequestRow[]> => {
    const rows = await db
      .select()
      .from(entryRequests)
      .where(eq(entryRequests.requestedBy, context.identity))
      .orderBy(desc(entryRequests.createdAt))
      .limit(50)
    return rows.map(toRow)
  })

/** Admin only: all requests (without screenshots), newest first. */
export const listRequests = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(async (): Promise<RequestRow[]> => {
    const rows = await db
      .select()
      .from(entryRequests)
      .orderBy(desc(entryRequests.createdAt))
      .limit(200)
    return rows.map(toRow)
  })

export const countPendingRequests = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(async () => {
    const [row] = await db
      .select({ n: sql<string>`count(*)` })
      .from(entryRequests)
      .where(eq(entryRequests.status, 'pending'))
    return { pending: Number(row?.n ?? 0) }
  })

/** Admin only: the screenshot attached to one request. */
export const getRequestProof = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const [row] = await db
      .select({ proof: entryRequests.proof })
      .from(entryRequests)
      .where(eq(entryRequests.id, data.id))
      .limit(1)
    return { proof: row?.proof ?? null }
  })

export type DecideResult = { ok: true } | { ok: false; error: string }

/** Admin only: approves (creates the entry) or rejects a pending request. */
export const decideRequest = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(
    z.object({
      id: z.number().int().positive(),
      decision: z.enum(['approve', 'reject']),
      note: z.string().trim().max(300).optional(),
    }),
  )
  .handler(async ({ data, context }): Promise<DecideResult> => {
    const next: RequestStatus = data.decision === 'approve' ? 'approved' : 'rejected'
    // Claim the request first so two admins cannot decide it twice.
    const [claimed] = await db
      .update(entryRequests)
      .set({
        status: next,
        decidedBy: context.identity,
        decidedAt: sql`now()`,
        note: data.note || null,
      })
      .where(and(eq(entryRequests.id, data.id), eq(entryRequests.status, 'pending')))
      .returning()
    if (!claimed) {
      return { ok: false, error: 'Ten wniosek został już rozpatrzony albo nie istnieje.' }
    }

    const label = `${claimed.firstName} ${claimed.lastName}`
    if (data.decision === 'approve') {
      const result = await insertPractitioner(
        {
          pesel: claimed.pesel,
          firstName: claimed.firstName,
          lastName: claimed.lastName,
          profession: claimed.profession,
          specialization: claimed.specialization,
        },
        claimed.requestedBy,
      )
      if (!result.ok) {
        // Put the request back so it can be rejected or retried.
        await db
          .update(entryRequests)
          .set({ status: 'pending', decidedBy: null, decidedAt: null, note: null })
          .where(eq(entryRequests.id, data.id))
        return { ok: false, error: result.error }
      }
      await logEvent({
        actor: context.identity,
        actorRole: ROLE_ADMIN,
        action: 'request_approve',
        target: `${label} (PWZ ${result.pwz})`,
        details: `Wniosek złożony przez ${claimed.requestedBy}`,
      })
      return { ok: true }
    }

    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'request_reject',
      target: `${label} (PESEL ${claimed.pesel})`,
      details: [
        `Wniosek złożony przez ${claimed.requestedBy}`,
        data.note ? `powód: ${data.note}` : null,
      ]
        .filter(Boolean)
        .join(', '),
    })
    return { ok: true }
  })
