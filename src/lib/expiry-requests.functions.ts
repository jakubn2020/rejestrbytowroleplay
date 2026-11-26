import { createServerFn } from '@tanstack/react-start'
import { FLAG_KEYS, readFlag } from './site-settings-server'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import { expiryRequests, practitioners } from '../../db/schema'
import { requireAdmin, requireStaff } from './auth-server'
import {
  EXPIRY_MODES,
  EXPIRY_UNITS,
  MAX_EXPIRY_DAYS,
  MAX_EXPIRY_MONTHS,
  ROLE_ADMIN,
  ROLE_MANAGEMENT,
  describeExpiryChoice,
  expiryFromChoice,
  toRequestStatus,
  validityLabel,
  type ExpiryUnitKey,
  type RequestStatus,
  type RequestedExpiryMode,
} from './registry'
import { proofSchema } from './schemas'
import {
  claimCooldown,
  cooldownLeft,
  logEvent,
  notifyAdmins,
  notifyUser,
  releaseCooldown,
} from './security-server'
import { permissionDenied } from './permissions-server'

const COOLDOWN_MESSAGE =
  'Kierownictwo może złożyć jeden wniosek na 5 minut. Spróbuj ponownie później.'

const submitInput = z
  .object({
    practitionerId: z.number().int().positive(),
    mode: z.enum(EXPIRY_MODES),
    amount: z.number().int().positive().optional(),
    unit: z.enum(EXPIRY_UNITS).optional(),
    proof: proofSchema,
  })
  .refine(
    (v) =>
      v.mode !== 'custom' ||
      (v.amount !== undefined &&
        v.unit !== undefined &&
        v.amount <= (v.unit === 'days' ? MAX_EXPIRY_DAYS : MAX_EXPIRY_MONTHS)),
    { message: 'Podaj poprawną liczbę dni lub miesięcy' },
  )

export type ExpirySubmitResult =
  | { ok: true }
  | { ok: false; error: string; secondsLeft?: number }

/** Kierownictwo: asks an admin to change the PWZ validity of an entry (with a screenshot as proof). */
export const submitExpiryRequest = createServerFn({ method: 'POST' })
  .middleware([requireStaff])
  .validator(submitInput)
  .handler(async ({ data, context }): Promise<ExpirySubmitResult> => {
    const denied = await permissionDenied(context.user, 'expiry_request')
    if (denied) return { ok: false, error: denied }
    if (context.isAdmin) {
      return {
        ok: false,
        error: 'Administrator zmienia termin bezpośrednio w oknie edycji wpisu.',
      }
    }
    if (!(await readFlag(FLAG_KEYS.requests))) {
      return { ok: false, error: 'Składanie wniosków jest chwilowo wyłączone przez właściciela.' }
    }
    const secondsLeft = await cooldownLeft(context.identity)
    if (secondsLeft > 0) return { ok: false, secondsLeft, error: COOLDOWN_MESSAGE }

    const [person] = await db
      .select()
      .from(practitioners)
      .where(eq(practitioners.id, data.practitionerId))
      .limit(1)
    if (!person || person.deletedAt) {
      return { ok: false, error: 'Nie znaleziono wpisu (mógł zostać usunięty).' }
    }
    const [pending] = await db
      .select({ id: expiryRequests.id })
      .from(expiryRequests)
      .where(
        and(
          eq(expiryRequests.practitionerId, person.id),
          eq(expiryRequests.status, 'pending'),
        ),
      )
      .limit(1)
    if (pending) {
      return {
        ok: false,
        error: 'Wniosek o zmianę terminu dla tej osoby już oczekuje na decyzję.',
      }
    }
    if (!(await claimCooldown(context.identity))) {
      return {
        ok: false,
        secondsLeft: await cooldownLeft(context.identity),
        error: COOLDOWN_MESSAGE,
      }
    }
    const name = `${person.firstName} ${person.lastName}`
    try {
      await db.insert(expiryRequests).values({
        requestedBy: context.identity,
        practitionerId: person.id,
        personName: name,
        pwz: person.pwz,
        mode: data.mode,
        amount: data.mode === 'custom' ? (data.amount ?? null) : null,
        unit: data.mode === 'custom' ? (data.unit ?? null) : null,
        proof: data.proof,
      })
    } catch (error) {
      console.error('Nie udało się zapisać wniosku o zmianę terminu', error)
      await releaseCooldown(context.identity)
      return { ok: false, error: 'Nie udało się zapisać wniosku. Spróbuj ponownie.' }
    }
    const wanted = describeExpiryChoice(data.mode, data.amount ?? null, data.unit ?? null)
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_MANAGEMENT,
      action: 'expiry_request_create',
      target: `${name} (PWZ ${person.pwz})`,
      details: `Chce: ${wanted}`,
    })
    await notifyAdmins(
      'Nowy wniosek o zmianę terminu PWZ',
      `${context.identity} prosi o zmianę ważności PWZ: ${name} (${wanted}). Sprawdź zrzut ekranu i zdecyduj.`,
    )
    return { ok: true }
  })

function toRow(row: typeof expiryRequests.$inferSelect) {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    requestedBy: row.requestedBy,
    personName: row.personName,
    pwz: row.pwz,
    wanted: describeExpiryChoice(row.mode, row.amount, row.unit),
    status: toRequestStatus(row.status) as RequestStatus,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    note: row.note,
  }
}

export type ExpiryRequestRow = ReturnType<typeof toRow>

export const listMyExpiryRequests = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .handler(async ({ context }): Promise<ExpiryRequestRow[]> => {
    const rows = await db
      .select()
      .from(expiryRequests)
      .where(eq(expiryRequests.requestedBy, context.identity))
      .orderBy(desc(expiryRequests.createdAt))
      .limit(50)
    return rows.map(toRow)
  })

export const listExpiryRequests = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(async (): Promise<ExpiryRequestRow[]> => {
    const rows = await db
      .select()
      .from(expiryRequests)
      .orderBy(desc(expiryRequests.createdAt))
      .limit(200)
    return rows.map(toRow)
  })

export const getExpiryRequestProof = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const [row] = await db
      .select({ proof: expiryRequests.proof })
      .from(expiryRequests)
      .where(eq(expiryRequests.id, data.id))
      .limit(1)
    return { proof: row?.proof ?? null }
  })

export type ExpiryDecideResult = { ok: true } | { ok: false; error: string }

/** Admin only: approves (sets the new validity, counted from today) or rejects a request. */
export const decideExpiryRequest = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(
    z.object({
      id: z.number().int().positive(),
      decision: z.enum(['approve', 'reject']),
      note: z.string().trim().max(300).optional(),
    }),
  )
  .handler(async ({ data, context }): Promise<ExpiryDecideResult> => {
    const next: RequestStatus = data.decision === 'approve' ? 'approved' : 'rejected'
    const [claimed] = await db
      .update(expiryRequests)
      .set({
        status: next,
        decidedBy: context.identity,
        decidedAt: sql`now()`,
        note: data.note || null,
      })
      .where(and(eq(expiryRequests.id, data.id), eq(expiryRequests.status, 'pending')))
      .returning()
    if (!claimed) {
      return { ok: false, error: 'Ten wniosek został już rozpatrzony albo nie istnieje.' }
    }
    const target = `${claimed.personName} (PWZ ${claimed.pwz})`

    if (data.decision === 'approve') {
      const [person] = await db
        .select()
        .from(practitioners)
        .where(eq(practitioners.id, claimed.practitionerId))
        .limit(1)
      if (!person || person.deletedAt) {
        await db
          .update(expiryRequests)
          .set({ status: 'pending', decidedBy: null, decidedAt: null, note: null })
          .where(eq(expiryRequests.id, data.id))
        return {
          ok: false,
          error: 'Ta osoba została usunięta z rejestru. Odrzuć wniosek.',
        }
      }
      const expiresAt = expiryFromChoice(
        claimed.mode as RequestedExpiryMode,
        claimed.amount,
        claimed.unit as ExpiryUnitKey | null,
      )
      await db
        .update(practitioners)
        .set({ expiresAt })
        .where(eq(practitioners.id, person.id))
      const before = validityLabel(person.expiresAt ? person.expiresAt.toISOString() : null)
      const after = validityLabel(expiresAt ? expiresAt.toISOString() : null)
      await logEvent({
        actor: context.identity,
        actorRole: ROLE_ADMIN,
        action: 'expiry_request_approve',
        target,
        details: `Ważność: ${before} → ${after}. Wniosek złożony przez ${claimed.requestedBy}`,
      })
      await notifyUser(
        claimed.requestedBy,
        'Wniosek o zmianę terminu zaakceptowany',
        `Wniosek o zmianę ważności PWZ dla ${claimed.personName} został zaakceptowany (ważność: ${after}).`,
      )
      return { ok: true }
    }

    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'expiry_request_reject',
      target,
      details: [
        `Wniosek złożony przez ${claimed.requestedBy}`,
        data.note ? `powód: ${data.note}` : null,
      ]
        .filter(Boolean)
        .join(', '),
    })
    await notifyUser(
      claimed.requestedBy,
      'Wniosek o zmianę terminu odrzucony',
      `Wniosek o zmianę ważności PWZ dla ${claimed.personName} został odrzucony.${data.note ? ` Powód: ${data.note}` : ''}`,
    )
    return { ok: true }
  })
