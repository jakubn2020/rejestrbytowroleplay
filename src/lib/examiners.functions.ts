import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, gt, inArray, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import { accountRemovalRequests, authSessions, entryRequests, mfaSessions, settings, users } from '../../db/schema'
import { requireAdmin, requireExamMod, requireExaminer, requireSuperAdmin } from './auth-server'
import { hashPassword } from './password'
import { isWeakPassword } from './password-strength'
import { findClash } from './practitioners-server'
import {
  ROLE_ADMIN,
  ROLE_EXAMINER,
  ROLE_EXAM_MOD,
  ROLE_MANAGEMENT,
  pwzFromPesel,
  toRequestStatus,
} from './registry'
import { practitionerInput, proofSchema } from './schemas'
import { logEvent, notifyAdmins, notifyUser } from './security-server'
import { FLAG_KEYS, clearSetting, readFlag, readNumberSetting, readSetting, writeSetting } from './site-settings-server'
import {
  EXAMINER_LIMIT_DEFAULTS,
  EXAMINER_LIMIT_FIELDS,
  OVERRIDE_KEYS,
  examinerLimitKey,
  userKey,
  type ExaminerLimits,
  type ExaminerOverride,
  type ExaminerRequestStats,
} from './examiners'
import { permissionDenied } from './permissions-server'

// ---------------------------------------------------------------------------
// Limits (the owner decides all of them)
// ---------------------------------------------------------------------------

function parseOverride(raw: string | null): ExaminerOverride {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const result: ExaminerOverride = {}
    for (const key of OVERRIDE_KEYS) {
      const n = value[key]
      if (typeof n === 'number' && Number.isFinite(n)) result[key] = n
    }
    return result
  } catch {
    return {}
  }
}

/** The general limits; with `userId` the owner's exceptions for that person are applied on top. */
async function readLimits(userId?: string): Promise<ExaminerLimits> {
  const entries = await Promise.all(
    EXAMINER_LIMIT_FIELDS.map(
      async (field) =>
        [field.key, await readNumberSetting(examinerLimitKey(field.key), EXAMINER_LIMIT_DEFAULTS[field.key])] as const,
    ),
  )
  const general = Object.fromEntries(entries) as ExaminerLimits
  if (!userId) return general
  return { ...general, ...parseOverride(await readSetting(userKey.override(userId))) }
}

/** Owner only: the current limits. */
export const getExaminerLimits = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .handler(async (): Promise<ExaminerLimits> => readLimits())

/** Owner only: saves the limits (every value is kept inside its allowed range). */
export const saveExaminerLimits = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(
    z.object({
      requestsCount: z.number().int(),
      requestsWindowMinutes: z.number().int(),
      pendingMax: z.number().int(),
      maxExaminers: z.number().int(),
      addPerDay: z.number().int(),
      removalPerDay: z.number().int(),
      suspendMaxHours: z.number().int(),
    }),
  )
  .handler(async ({ data, context }) => {
    for (const field of EXAMINER_LIMIT_FIELDS) {
      const value = Math.min(field.max, Math.max(field.min, data[field.key]))
      await writeSetting(examinerLimitKey(field.key), String(value))
    }
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'examiner_limits',
      details: EXAMINER_LIMIT_FIELDS.map((f) => `${f.key}=${data[f.key]}`).join(', '),
    })
    return { ok: true as const }
  })

/** Owner only: limits for one person (an exception to the general limits); `null` removes the exception. */
export const setExaminerOverride = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(
    z.object({
      id: z.string().min(1).max(100),
      override: z
        .object({
          requestsCount: z.number().int().min(1).max(50).optional(),
          requestsWindowMinutes: z.number().int().min(1).max(1440).optional(),
          pendingMax: z.number().int().min(1).max(200).optional(),
        })
        .nullable(),
    }),
  )
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const [row] = await db.select().from(users).where(eq(users.id, data.id)).limit(1)
    if (!row || !(row.roles.includes(ROLE_EXAMINER) || row.roles.includes(ROLE_EXAM_MOD))) {
      return { ok: false, error: 'To nie jest konto egzaminatora ani moderatora.' }
    }
    const clean = data.override ? Object.fromEntries(Object.entries(data.override).filter(([, v]) => v !== undefined)) : null
    if (!clean || Object.keys(clean).length === 0) await clearSetting(userKey.override(row.id))
    else await writeSetting(userKey.override(row.id), JSON.stringify(clean))
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'examiner_limits',
      target: row.email,
      details: clean && Object.keys(clean).length ? `Wyjątek: ${JSON.stringify(clean)}` : 'Wyjątek usunięty (obowiązują limity ogólne)',
    })
    return { ok: true }
  })

// ---------------------------------------------------------------------------
// Examiner: entry requests within the limit
// ---------------------------------------------------------------------------

export type ExaminerOverview = {
  limits: Pick<ExaminerLimits, 'requestsCount' | 'requestsWindowMinutes' | 'pendingMax'>
  usedInWindow: number
  /** Seconds until one more request fits (0 when it fits now). */
  secondsToNext: number
  pending: number
  stats: ExaminerRequestStats
  /** Requests per day for the last 14 days, oldest first. */
  days: number[]
  requestsOpen: boolean
}

async function windowUsage(identity: string, minutes: number, count: number) {
  const rows = await db
    .select({
      secondsAgo: sql<string>`extract(epoch from (now() - ${entryRequests.createdAt}))`,
    })
    .from(entryRequests)
    .where(
      and(
        eq(entryRequests.requestedBy, identity),
        gt(entryRequests.createdAt, sql`now() - (${minutes} * interval '1 minute')`),
      ),
    )
    .orderBy(entryRequests.createdAt)
  const used = rows.length
  let secondsToNext = 0
  if (used >= count) {
    // The request that frees a slot is the (used - count + 1)-th oldest one in the window.
    const blocking = rows[used - count]
    secondsToNext = Math.max(1, Math.ceil(minutes * 60 - Number(blocking.secondsAgo)))
  }
  return { used, secondsToNext }
}

/** Examiner: the limit meter, the counters and a small activity chart. */
export const examinerOverview = createServerFn({ method: 'GET' })
  .middleware([requireExaminer])
  .handler(async ({ context }): Promise<ExaminerOverview> => {
    const limits = await readLimits(context.user.id)
    const usage = await windowUsage(context.identity, limits.requestsWindowMinutes, limits.requestsCount)
    const mine = await db
      .select({ status: entryRequests.status, createdAt: entryRequests.createdAt })
      .from(entryRequests)
      .where(eq(entryRequests.requestedBy, context.identity))
    const stats: ExaminerRequestStats = { total: mine.length, approved: 0, rejected: 0, pending: 0 }
    const days = new Array<number>(14).fill(0)
    const now = Date.now()
    for (const row of mine) {
      if (row.status === 'approved') stats.approved++
      else if (row.status === 'rejected') stats.rejected++
      else stats.pending++
      const ago = Math.floor((now - row.createdAt.getTime()) / 86_400_000)
      if (ago >= 0 && ago < 14) days[13 - ago]++
    }
    return {
      limits: {
        requestsCount: limits.requestsCount,
        requestsWindowMinutes: limits.requestsWindowMinutes,
        pendingMax: limits.pendingMax,
      },
      usedInWindow: usage.used,
      secondsToNext: usage.secondsToNext,
      pending: stats.pending,
      stats,
      days,
      requestsOpen: await readFlag(FLAG_KEYS.requests),
    }
  })

export type ExaminerSubmitResult =
  | { ok: true }
  | { ok: false; error: string; secondsLeft?: number }

/** Examiner: asks for a new entry (PESEL + screenshot). At most N requests per window, set by the owner. */
export const submitExaminerRequest = createServerFn({ method: 'POST' })
  .middleware([requireExaminer])
  .validator(z.object({ person: practitionerInput, proof: proofSchema }))
  .handler(async ({ data, context }): Promise<ExaminerSubmitResult> => {
    const denied = await permissionDenied(context.user, 'request_create')
    if (denied) return { ok: false, error: denied }
    if (!(await readFlag(FLAG_KEYS.requests))) {
      return { ok: false, error: 'Składanie wniosków jest chwilowo wyłączone przez właściciela.' }
    }
    const limits = await readLimits(context.user.id)
    const wait = (seconds: number): ExaminerSubmitResult => ({
      ok: false,
      secondsLeft: seconds,
      error: `Limit wniosków: ${limits.requestsCount} na ${limits.requestsWindowMinutes} min. Kolejny możesz złożyć za ${Math.ceil(seconds / 60)} min.`,
    })

    const before = await windowUsage(context.identity, limits.requestsWindowMinutes, limits.requestsCount)
    if (before.used >= limits.requestsCount) return wait(before.secondsToNext)

    const [pendingMine] = await db
      .select({ n: sql<string>`count(*)` })
      .from(entryRequests)
      .where(and(eq(entryRequests.requestedBy, context.identity), eq(entryRequests.status, 'pending')))
    if (Number(pendingMine?.n ?? 0) >= limits.pendingMax) {
      return { ok: false, error: `Masz już ${limits.pendingMax} wniosków czekających na decyzję. Poczekaj na administratora.` }
    }

    const { person, proof } = data
    const clash = await findClash(person.pesel, pwzFromPesel(person.pesel))
    if (clash) return { ok: false, error: clash }
    const [same] = await db
      .select({ id: entryRequests.id })
      .from(entryRequests)
      .where(and(eq(entryRequests.pesel, person.pesel), eq(entryRequests.status, 'pending')))
      .limit(1)
    if (same) return { ok: false, error: 'Wniosek dla tego numeru PESEL już oczekuje na decyzję.' }

    let insertedId: number
    try {
      const [row] = await db
        .insert(entryRequests)
        .values({
          requestedBy: context.identity,
          pesel: person.pesel,
          firstName: person.firstName,
          lastName: person.lastName,
          profession: person.profession,
          specialization: person.specialization,
          proof,
        })
        .returning({ id: entryRequests.id })
      insertedId = row.id
    } catch (error) {
      console.error('Nie udało się zapisać wniosku egzaminatora', error)
      return { ok: false, error: 'Nie udało się zapisać wniosku. Spróbuj ponownie.' }
    }
    // Two requests sent at the same moment could both pass the check above: count again and undo the extra one.
    const after = await windowUsage(context.identity, limits.requestsWindowMinutes, limits.requestsCount)
    if (after.used > limits.requestsCount) {
      await db.delete(entryRequests).where(eq(entryRequests.id, insertedId))
      return wait(Math.max(after.secondsToNext, 60))
    }

    await logEvent({
      actor: context.identity,
      actorRole: context.user.roles.includes(ROLE_EXAMINER) ? ROLE_EXAMINER : ROLE_EXAM_MOD,
      action: 'request_create',
      target: `${person.firstName} ${person.lastName} (PESEL ${person.pesel})`,
      details: `Zawód: ${person.profession} (${context.user.roles.includes(ROLE_EXAMINER) ? 'egzaminator' : 'moderator egzaminatorów'})`,
    })
    await notifyAdmins(
      'Nowy wniosek o wpis do rejestru',
      `${context.user.roles.includes(ROLE_EXAMINER) ? 'Egzaminator' : 'Moderator egzaminatorów'} ${context.identity} złożył(a) wniosek o wpis: ${person.firstName} ${person.lastName} (${person.profession}). Sprawdź zrzut ekranu i zaakceptuj lub odrzuć wniosek.`,
    )
    return { ok: true }
  })

export type ExaminerRequestRow = {
  id: number
  createdAt: string
  pesel: string
  firstName: string
  lastName: string
  profession: string
  status: ReturnType<typeof toRequestStatus>
  decidedAt: string | null
  note: string | null
}

/** Examiner: own requests (without screenshots) and the administrators' decisions. */
export const listMyExaminerRequests = createServerFn({ method: 'GET' })
  .middleware([requireExaminer])
  .handler(async ({ context }): Promise<ExaminerRequestRow[]> => {
    const rows = await db
      .select()
      .from(entryRequests)
      .where(eq(entryRequests.requestedBy, context.identity))
      .orderBy(desc(entryRequests.createdAt))
      .limit(50)
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      pesel: row.pesel,
      firstName: row.firstName,
      lastName: row.lastName,
      profession: row.profession,
      status: toRequestStatus(row.status),
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
      note: row.note,
    }))
  })

// ---------------------------------------------------------------------------
// Accounts: shared helpers
// ---------------------------------------------------------------------------

const emailSchema = z.string().trim().toLowerCase().email('Podaj poprawny adres e-mail').max(200)
const passwordSchema = z.string().min(8, 'Hasło musi mieć co najmniej 8 znaków').max(200)
const idSchema = z.object({ id: z.string().min(1).max(100) })

export type ExamStaffAccount = {
  id: string
  email: string
  role: 'examiner' | 'moderator'
  createdAt: string
  createdBy: string | null
  lastLoginAt: string | null
  /** ISO time until which the account is suspended, or null. */
  suspendedUntil: string | null
  locked: boolean
  requestsWeek: number
  requestsApproved: number
  pendingRemoval: boolean
  /** Why the account was suspended (shown to the person at sign-in). */
  suspendReason: string | null
  /** An appeal from the suspended person, if any. */
  appeal: { at: string; message: string } | null
  /** The owner's exception to the general limits for this person. */
  override: ExaminerOverride | null
}

/** Accounts that have an examiner role and no admin / kierownictwo role. */
async function examStaffRows(roles: string[]) {
  const rows = await db.select().from(users).orderBy(users.email)
  return rows.filter(
    (row) =>
      roles.some((role) => row.roles.includes(role)) &&
      !row.roles.includes(ROLE_ADMIN) &&
      !row.roles.includes(ROLE_MANAGEMENT),
  )
}

function readReason(raw: string | null): string | null {
  try {
    const value = raw ? (JSON.parse(raw) as { reason?: unknown }) : null
    return typeof value?.reason === 'string' && value.reason ? value.reason : null
  } catch {
    return null
  }
}

function readAppeal(raw: string | null): { at: string; message: string } | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as { at?: unknown; message?: unknown }
    return { at: typeof value.at === 'string' ? value.at : '', message: typeof value.message === 'string' ? value.message : '' }
  } catch {
    return { at: '', message: '' }
  }
}

function readOverride(raw: string | null): ExaminerOverride | null {
  const value = parseOverride(raw)
  return Object.keys(value).length ? value : null
}

async function toAccounts(rows: Awaited<ReturnType<typeof examStaffRows>>): Promise<ExamStaffAccount[]> {
  if (rows.length === 0) return []
  const emails = rows.map((row) => row.email.toLowerCase())
  const requests = await db
    .select({ by: entryRequests.requestedBy, status: entryRequests.status, createdAt: entryRequests.createdAt })
    .from(entryRequests)
    .where(inArray(entryRequests.requestedBy, emails))
  const removals = await db
    .select({ target: accountRemovalRequests.targetEmail })
    .from(accountRemovalRequests)
    .where(eq(accountRemovalRequests.status, 'pending'))
  const pendingRemoval = new Set(removals.map((r) => r.target.toLowerCase()))
  const extras = await db
    .select()
    .from(settings)
    .where(or(like(settings.key, 'susp\\_%'), like(settings.key, 'appeal\\_%'), like(settings.key, 'exlim\\_user\\_%')))
  const extra = (key: string) => extras.find((e) => e.key === key)?.value ?? null
  const weekAgo = Date.now() - 7 * 86_400_000
  const now = Date.now()
  return rows.map((row) => {
    const mine = requests.filter((r) => r.by === row.email.toLowerCase())
    const until = row.frozenUntil && row.frozenUntil.getTime() > now ? row.frozenUntil.toISOString() : null
    return {
      id: row.id,
      email: row.email,
      role: row.roles.includes(ROLE_EXAM_MOD) ? 'moderator' : 'examiner',
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
      lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
      suspendedUntil: until,
      locked: row.locked,
      requestsWeek: mine.filter((r) => r.createdAt.getTime() > weekAgo).length,
      requestsApproved: mine.filter((r) => r.status === 'approved').length,
      pendingRemoval: pendingRemoval.has(row.email.toLowerCase()),
      suspendReason: until ? readReason(extra(userKey.suspension(row.id))) : null,
      appeal: until ? readAppeal(extra(userKey.appeal(row.id))) : null,
      override: readOverride(extra(userKey.override(row.id))),
    }
  })
}

async function signOutEverywhere(user: { id: string; email: string }) {
  await db.delete(authSessions).where(eq(authSessions.userId, user.id))
  await db.delete(mfaSessions).where(eq(mfaSessions.identity, user.email.toLowerCase()))
}

async function addExamAccount(
  input: { email: string; password: string },
  role: string,
  actor: { identity: string; role: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await db.insert(users).values({
      email: input.email,
      passwordHash: await hashPassword(input.password),
      weakPassword: isWeakPassword(input.password, input.email),
      roles: [role],
      createdBy: actor.identity,
      // The password was chosen by somebody else, so the new person must replace it at the first sign-in.
      mustChangePassword: true,
    })
  } catch (error) {
    const text = error instanceof Error ? `${error.message} ${String((error as Error & { cause?: unknown }).cause ?? '')}` : ''
    return {
      ok: false,
      error: /duplicate|unique|already/i.test(text)
        ? 'Konto z tym adresem e-mail już istnieje.'
        : 'Nie udało się utworzyć konta. Spróbuj ponownie.',
    }
  }
  await logEvent({
    actor: actor.identity,
    actorRole: actor.role,
    action: 'examiner_add',
    target: input.email,
    details: `Rola: ${role}`,
  })
  return { ok: true }
}

const DAY_SQL = sql`now() - interval '24 hours'`

// ---------------------------------------------------------------------------
// Moderator of examiners
// ---------------------------------------------------------------------------

export type ModOverview = {
  limits: Pick<ExaminerLimits, 'maxExaminers' | 'addPerDay' | 'removalPerDay' | 'suspendMaxHours'>
  examinerCount: number
  addedToday: number
  removalsToday: number
  accounts: ExamStaffAccount[]
  myRemovals: RemovalRow[]
}

export type RemovalRow = {
  id: number
  createdAt: string
  requestedBy: string
  targetEmail: string
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  decidedAt: string | null
  note: string | null
}

function toRemoval(row: typeof accountRemovalRequests.$inferSelect): RemovalRow {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    requestedBy: row.requestedBy,
    targetEmail: row.targetEmail,
    reason: row.reason,
    status: row.status === 'approved' || row.status === 'rejected' ? row.status : 'pending',
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    note: row.note,
  }
}

/** Moderator: the examiners, counters of the daily limits and own removal requests. */
export const modOverview = createServerFn({ method: 'GET' })
  .middleware([requireExamMod])
  .handler(async ({ context }): Promise<ModOverview> => {
    const limits = await readLimits()
    const accounts = await toAccounts(await examStaffRows([ROLE_EXAMINER]))
    const [added] = await db
      .select({ n: sql<string>`count(*)` })
      .from(users)
      .where(and(eq(users.createdBy, context.identity), sql`${ROLE_EXAMINER} = any(${users.roles})`, gt(users.createdAt, DAY_SQL)))
    const [removed] = await db
      .select({ n: sql<string>`count(*)` })
      .from(accountRemovalRequests)
      .where(and(eq(accountRemovalRequests.requestedBy, context.identity), gt(accountRemovalRequests.createdAt, DAY_SQL)))
    const mine = await db
      .select()
      .from(accountRemovalRequests)
      .where(eq(accountRemovalRequests.requestedBy, context.identity))
      .orderBy(desc(accountRemovalRequests.createdAt))
      .limit(30)
    return {
      limits: {
        maxExaminers: limits.maxExaminers,
        addPerDay: limits.addPerDay,
        removalPerDay: limits.removalPerDay,
        suspendMaxHours: limits.suspendMaxHours,
      },
      examinerCount: accounts.length,
      addedToday: Number(added?.n ?? 0),
      removalsToday: Number(removed?.n ?? 0),
      accounts,
      myRemovals: mine.map(toRemoval),
    }
  })

/** Moderator: adds an examiner account (the examiner must change the password at the first sign-in). */
export const addExaminer = createServerFn({ method: 'POST' })
  .middleware([requireExamMod])
  .validator(z.object({ email: emailSchema, password: passwordSchema }))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const denied = await permissionDenied(context.user, 'moderate_examiners')
    if (denied) return { ok: false, error: denied }
    const limits = await readLimits()
    const total = (await examStaffRows([ROLE_EXAMINER])).length
    if (total >= limits.maxExaminers) {
      return { ok: false, error: `Osiągnięto limit ${limits.maxExaminers} kont egzaminatorów ustawiony przez właściciela.` }
    }
    const [added] = await db
      .select({ n: sql<string>`count(*)` })
      .from(users)
      .where(and(eq(users.createdBy, context.identity), sql`${ROLE_EXAMINER} = any(${users.roles})`, gt(users.createdAt, DAY_SQL)))
    if (Number(added?.n ?? 0) >= limits.addPerDay) {
      return { ok: false, error: `Dzienny limit nowych kont (${limits.addPerDay}) został wykorzystany. Spróbuj jutro.` }
    }
    return addExamAccount(data, ROLE_EXAMINER, { identity: context.identity, role: ROLE_EXAM_MOD })
  })

async function examinerTarget(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  if (!row || !row.roles.includes(ROLE_EXAMINER) || row.roles.includes(ROLE_ADMIN) || row.roles.includes(ROLE_MANAGEMENT)) {
    return null
  }
  return row
}

/** Moderator: suspends an examiner for a number of hours (0 lifts the suspension). */
export const suspendExaminer = createServerFn({ method: 'POST' })
  .middleware([requireExamMod])
  .validator(
    z.object({
      id: idSchema.shape.id,
      hours: z.number().int().min(0).max(720),
      reason: z.string().trim().max(300).optional(),
    }),
  )
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const denied = await permissionDenied(context.user, 'moderate_examiners')
    if (denied) return { ok: false, error: denied }
    const limits = await readLimits()
    if (data.hours > limits.suspendMaxHours) {
      return { ok: false, error: `Najdłuższe zawieszenie, jakie możesz nałożyć: ${limits.suspendMaxHours} godz. Dłuższe zawieszenie zgłoś administratorowi.` }
    }
    const target = await examinerTarget(data.id)
    if (!target) return { ok: false, error: 'To konto nie jest kontem egzaminatora.' }
    if (data.hours === 0) {
      await db.update(users).set({ frozenUntil: null }).where(eq(users.id, target.id))
      await clearSetting(userKey.suspension(target.id))
      await clearSetting(userKey.appeal(target.id))
    } else {
      await writeSetting(
        userKey.suspension(target.id),
        JSON.stringify({ reason: data.reason ?? '', by: context.identity, at: new Date().toISOString() }),
      )
      await clearSetting(userKey.appeal(target.id))
      await db
        .update(users)
        .set({ frozenUntil: sql`now() + (${data.hours} * interval '1 hour')` })
        .where(eq(users.id, target.id))
      await signOutEverywhere(target)
    }
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_EXAM_MOD,
      action: 'examiner_suspend',
      target: target.email,
      details: data.hours === 0 ? 'Zawieszenie zdjęte' : `Zawieszono na ${data.hours} godz.${data.reason ? `, powód: ${data.reason}` : ''}`,
    })
    await notifyUser(
      target.email,
      data.hours === 0 ? 'Konto odwieszone' : 'Konto zawieszone',
      data.hours === 0
        ? 'Zawieszenie Twojego konta egzaminatora zostało zdjęte.'
        : `Twoje konto egzaminatora zostało zawieszone na ${data.hours} godz. przez moderatora.${data.reason ? ` Powód: ${data.reason}` : ''}`,
    )
    return { ok: true }
  })

/** Moderator: asks an administrator to delete an examiner account. */
export const requestExaminerRemoval = createServerFn({ method: 'POST' })
  .middleware([requireExamMod])
  .validator(z.object({ id: idSchema.shape.id, reason: z.string().trim().min(5, 'Podaj powód (co najmniej 5 znaków)').max(500) }))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const denied = await permissionDenied(context.user, 'moderate_examiners')
    if (denied) return { ok: false, error: denied }
    const limits = await readLimits()
    const target = await examinerTarget(data.id)
    if (!target) return { ok: false, error: 'To konto nie jest kontem egzaminatora.' }
    const [open] = await db
      .select({ id: accountRemovalRequests.id })
      .from(accountRemovalRequests)
      .where(and(eq(accountRemovalRequests.targetEmail, target.email), eq(accountRemovalRequests.status, 'pending')))
      .limit(1)
    if (open) return { ok: false, error: 'Wniosek o usunięcie tego konta już czeka na decyzję.' }
    const [today] = await db
      .select({ n: sql<string>`count(*)` })
      .from(accountRemovalRequests)
      .where(and(eq(accountRemovalRequests.requestedBy, context.identity), gt(accountRemovalRequests.createdAt, DAY_SQL)))
    if (Number(today?.n ?? 0) >= limits.removalPerDay) {
      return { ok: false, error: `Dzienny limit wniosków o usunięcie (${limits.removalPerDay}) został wykorzystany.` }
    }
    await db.insert(accountRemovalRequests).values({
      requestedBy: context.identity,
      targetEmail: target.email,
      reason: data.reason,
    })
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_EXAM_MOD,
      action: 'examiner_removal_request',
      target: target.email,
      details: data.reason,
    })
    await notifyAdmins(
      'Wniosek o usunięcie konta egzaminatora',
      `Moderator ${context.identity} prosi o usunięcie konta ${target.email}. Powód: ${data.reason}`,
    )
    return { ok: true }
  })

// ---------------------------------------------------------------------------
// Administrators: moderators, removal requests
// ---------------------------------------------------------------------------

export type AdminExamStaff = {
  accounts: ExamStaffAccount[]
  removals: RemovalRow[]
}

/** Admin: all examiner and moderator accounts and the removal requests. */
export const adminExamStaff = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(async (): Promise<AdminExamStaff> => {
    const accounts = await toAccounts(await examStaffRows([ROLE_EXAMINER, ROLE_EXAM_MOD]))
    const removals = await db
      .select()
      .from(accountRemovalRequests)
      .orderBy(desc(accountRemovalRequests.createdAt))
      .limit(100)
    return { accounts, removals: removals.map(toRemoval) }
  })

export const countPendingRemovals = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(async () => {
    const [row] = await db
      .select({ n: sql<string>`count(*)` })
      .from(accountRemovalRequests)
      .where(eq(accountRemovalRequests.status, 'pending'))
    return { pending: Number(row?.n ?? 0) }
  })

/** Admin: creates an examiner or a moderator account. */
export const addExamStaff = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(z.object({ email: emailSchema, password: passwordSchema, role: z.enum(['examiner', 'moderator']) }))
  .handler(async ({ data, context }) => {
    const denied = await permissionDenied(context.user, 'manage_examiners')
    if (denied) return { ok: false as const, error: denied }
    return addExamAccount(
      { email: data.email, password: data.password },
      data.role === 'moderator' ? ROLE_EXAM_MOD : ROLE_EXAMINER,
      { identity: context.identity, role: ROLE_ADMIN },
    )
  })

/** Admin: deletes an examiner or moderator account right away (no request needed). */
export const deleteExamStaff = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(idSchema)
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const denied = await permissionDenied(context.user, 'manage_examiners')
    if (denied) return { ok: false, error: denied }
    const [row] = await db.select().from(users).where(eq(users.id, data.id)).limit(1)
    if (!row || row.roles.includes(ROLE_ADMIN) || row.roles.includes(ROLE_MANAGEMENT) || !(row.roles.includes(ROLE_EXAMINER) || row.roles.includes(ROLE_EXAM_MOD))) {
      return { ok: false, error: 'To nie jest konto egzaminatora ani moderatora.' }
    }
    await signOutEverywhere(row)
    await db.delete(users).where(eq(users.id, row.id))
    await logEvent({ actor: context.identity, actorRole: ROLE_ADMIN, action: 'examiner_delete', target: row.email })
    return { ok: true }
  })

/** Admin: approves (deletes the account) or rejects a moderator's removal request. */
export const decideRemoval = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(z.object({ id: z.number().int().positive(), decision: z.enum(['approve', 'reject']), note: z.string().trim().max(300).optional() }))
  .handler(async ({ data, context }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const denied = await permissionDenied(context.user, 'manage_examiners')
    if (denied) return { ok: false, error: denied }
    const [claimed] = await db
      .update(accountRemovalRequests)
      .set({
        status: data.decision === 'approve' ? 'approved' : 'rejected',
        decidedBy: context.identity,
        decidedAt: sql`now()`,
        note: data.note || null,
      })
      .where(and(eq(accountRemovalRequests.id, data.id), eq(accountRemovalRequests.status, 'pending')))
      .returning()
    if (!claimed) return { ok: false, error: 'Ten wniosek został już rozpatrzony albo nie istnieje.' }
    if (data.decision === 'approve') {
      const [target] = await db.select().from(users).where(eq(users.email, claimed.targetEmail)).limit(1)
      if (target && target.roles.includes(ROLE_EXAMINER) && !target.roles.includes(ROLE_ADMIN) && !target.roles.includes(ROLE_MANAGEMENT)) {
        await signOutEverywhere(target)
        await db.delete(users).where(eq(users.id, target.id))
      }
    }
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'examiner_removal_decide',
      target: claimed.targetEmail,
      details: `${data.decision === 'approve' ? 'Zaakceptowano' : 'Odrzucono'} wniosek moderatora ${claimed.requestedBy}${data.note ? `, uwaga: ${data.note}` : ''}`,
    })
    await notifyUser(
      claimed.requestedBy,
      data.decision === 'approve' ? 'Konto egzaminatora usunięte' : 'Wniosek o usunięcie odrzucony',
      data.decision === 'approve'
        ? `Administrator zaakceptował wniosek o usunięcie konta ${claimed.targetEmail}.`
        : `Administrator odrzucił wniosek o usunięcie konta ${claimed.targetEmail}.${data.note ? ` Uwaga: ${data.note}` : ''}`,
    )
    return { ok: true }
  })
