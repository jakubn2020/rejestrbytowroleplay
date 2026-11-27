import { createServerFn } from '@tanstack/react-start'
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  ne,
  or,
  sql,
} from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import {
  auditLog,
  entryRevisions,
  mfaSessions,
  practitioners,
  authSessions,
  users,
  type Practitioner,
} from '../../db/schema'
import { requireAdmin, requireStaff, requireSuperAdmin, needs } from './auth-server'
import { superAdminEmail } from './session-server'
import { hashPassword } from './password'
import { newPasswordSchema } from './password-schema'
import { isWeakPassword } from './password-strength'
import { insertPractitioner, purgeTrashedClash } from './practitioners-server'
import {
  ENTRY_STATUSES,
  ENTRY_STATUS_KEYS,
  ROLE_ADMIN,
  ROLE_MANAGEMENT,
  TRASH_RETENTION_DAYS,
  entryNumber,
  effectiveStatus,
  isParamedic,
  validityLabel,
  professionKind,
  type EntryStatus,
  type PublicEntry,
} from './registry'
import { peselSchema, practitionerInput } from './schemas'
import { autoBan, ipBanned } from './ip-policy-server'
import {
  PESEL_QUOTA_MESSAGE,
  clientIp,
  countEvents,
  logEvent,
  logPeselView,
  lookupAllowed,
  peselQuotaExceeded,
  raiseAlert,
  recordEvent,
  trackTraffic,
} from './security-server'
import { FLAG_KEYS, readFlag, readMaintenance } from './site-settings-server'

/** Rows that are not in the trash. */
const alive = isNull(practitioners.deletedAt)

type Snapshot = {
  pesel: string
  pwz: string
  specialization: string | null
  status: string
  expiresAt: string | null
}

/** Remembers how an entry looked before a change, so the change can be undone later. */
async function saveRevision(before: Practitioner, actor: string, summary: string) {
  const snapshot: Snapshot = {
    pesel: before.pesel,
    pwz: before.pwz,
    specialization: before.specialization ?? null,
    status: before.status,
    expiresAt: before.expiresAt ? before.expiresAt.toISOString() : null,
  }
  await db.insert(entryRevisions).values({
    entryId: before.id,
    actor,
    summary,
    before: JSON.stringify(snapshot),
  })
  // Keep the history short: the 20 newest changes per entry.
  await db.execute(
    sql`delete from entry_revisions where entry_id = ${before.id} and id not in (select id from entry_revisions where entry_id = ${before.id} order by id desc limit 20)`,
  )
}

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
    status: effectiveStatus(toStatus(row.status), row.expiresAt),
    entryNumber: entryNumber(row.id),
    entryDate: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  }
}

const searchInput = z.object({ q: z.string().trim().min(1).max(120) })

export type SearchResult =
  | { status: 'ok'; mode: 'pesel' | 'pwz' | 'name'; entries: PublicEntry[] }
  | { status: 'invalid'; message: string }

/**
 * Numbers that are not in the registry, over and over from one address, look like guessing:
 * raise an alert and ban the address for a while.
 */
async function noteMiss(kind: string, alertKind: string, limit: number, what: string) {
  const ip = clientIp()
  if (!ip) return
  await recordEvent({ kind, ip })
  const misses = await countEvents({ kind, ip, minutes: 10 })
  if (misses >= limit) {
    await raiseAlert({
      kind: alertKind,
      ip,
      details: `Adres ${ip}: ${misses} nieudanych zapytań w ciągu 10 minut (${what}).`,
      dedupeMinutes: 30,
    })
    await autoBan(ip, 60, what)
  }
}

export const searchRegistry = createServerFn({ method: 'GET' })
  .validator(searchInput)
  .handler(async ({ data }): Promise<SearchResult> => {
    const maintenance = await readMaintenance()
    if (maintenance.closed) return { status: 'invalid', message: maintenance.message }
    if (!(await readFlag(FLAG_KEYS.search))) {
      return { status: 'invalid', message: 'Wyszukiwarka jest chwilowo wyłączona. Spróbuj ponownie później.' }
    }
    if (await ipBanned()) {
      return { status: 'invalid', message: 'Dostęp z tego adresu został zablokowany.' }
    }
    await trackTraffic()
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
      if (rows.length === 0) await noteMiss('lookup_miss', 'pwz_guessing', 20, 'zgadywanie numerów PESEL/PWZ')
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
  .middleware([requireStaff, needs('registry.view')])
  .handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(practitioners)
      .where(alive)
      .orderBy(desc(practitioners.createdAt))
    return rows.map((row) => ({
      id: row.id,
      // Admins get the PESEL with the list (no extra click); kierownictwo must reveal it
      // with `revealPesel`, which is audited.
      pesel: context.isAdmin ? row.pesel : null,
      // Raw value (or null) so the admin edit form can be prefilled.
      rawSpecialization: row.specialization,
      /** The status as stored (the `status` below also reflects an expired validity). */
      storedStatus: toStatus(row.status),
      createdBy: row.createdBy,
      ...toPublic(row),
    }))
  })

/** Staff only: shows one PESEL. Every call is written to the audit log. */
export const revealPesel = createServerFn({ method: 'POST' })
  .middleware([requireStaff, needs('pesel.reveal')])
  .validator(
    z.object({
      id: z.number().int().positive(),
      purpose: z.enum(['podgląd w tabeli', 'edycja wpisu', 'kopiowanie']),
    }),
  )
  .handler(async ({ data, context }) => {
    const [row] = await db
      .select()
      .from(practitioners)
      .where(and(eq(practitioners.id, data.id), alive))
      .limit(1)
    if (!row) return { pesel: null, error: null }
    if (await peselQuotaExceeded(context.identity)) {
      return { pesel: null, error: PESEL_QUOTA_MESSAGE }
    }
    await logPeselView({
      actor: context.identity,
      actorRole: context.isAdmin ? ROLE_ADMIN : ROLE_MANAGEMENT,
      target: `${row.firstName} ${row.lastName} (PWZ ${row.pwz})`,
      purpose: data.purpose,
      entryId: row.id,
    })
    return { pesel: row.pesel, error: null }
  })

/** Staff only: ids of entries whose PESEL contains the digits (lets the panel search by PESEL without sending PESELs). */
export const findPeselMatches = createServerFn({ method: 'GET' })
  .middleware([requireStaff])
  .validator(z.object({ q: z.string().regex(/^\d{6,100}$/) }))
  .handler(async ({ data }) => {
    const rows = await db
      .select({ id: practitioners.id })
      .from(practitioners)
      .where(and(alive, like(practitioners.pesel, `%${data.q}%`)))
      .limit(20)
    return { ids: rows.map((row) => row.id) }
  })

/** Public: how many active entries there are per profession. */
export const getPublicStats = createServerFn({ method: 'GET' }).handler(
  async () => {
    const rows = await db
      .select({
        profession: practitioners.profession,
        n: sql<string>`count(*)`,
      })
      .from(practitioners)
      .where(
        and(
          alive,
          eq(practitioners.status, 'active'),
          or(isNull(practitioners.expiresAt), gt(practitioners.expiresAt, sql`now()`)),
        ),
      )
      .groupBy(practitioners.profession)
    const stats = { doctors: 0, nurses: 0, paramedics: 0 }
    for (const row of rows) {
      const kind = professionKind(row.profession)
      const n = Number(row.n)
      if (kind === 'doctor') stats.doctors += n
      else if (kind === 'nurse') stats.nurses += n
      else stats.paramedics += n
    }
    return stats
  },
)

export type AddResult = { ok: true; pwz: string } | { ok: false; error: string }

/** Admin only: adds a person directly. `kierownictwo` submits a request instead (see requests.functions.ts). */
export const addPractitioner = createServerFn({ method: 'POST' })
  .middleware([requireAdmin, needs('entries.add')])
  .validator(practitionerInput)
  .handler(async ({ data, context }): Promise<AddResult> => {
    if (data.expiresAt && data.expiresAt <= new Date()) {
      return { ok: false, error: 'Termin ważności musi być w przyszłości.' }
    }
    const result = await insertPractitioner(data, context.identity)
    if (!result.ok) return result
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'add',
      target: `${data.firstName} ${data.lastName} (PWZ ${result.pwz})`,
      details: [
        `Zawód: ${data.profession}`,
        `ważność: ${validityLabel(data.expiresAt ? data.expiresAt.toISOString() : null)}`,
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
  /** undefined = leave the validity unchanged, null = lifetime, otherwise a future ISO date. */
  expiresAt: z.string().datetime().nullable().optional(),
})

export type UpdateResult = { ok: true } | { ok: false; error: string }

/** Admin only: change PESEL, set PWZ by hand, edit the specialization and the status of an existing entry. */
export const updatePractitioner = createServerFn({ method: 'POST' })
  .middleware([requireAdmin, needs('entries.edit')])
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
      .select({ pesel: practitioners.pesel })
      .from(practitioners)
      .where(
        and(
          ne(practitioners.id, data.id),
          alive,
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
    let expiresAt = existing.expiresAt
    if (data.expiresAt !== undefined) {
      expiresAt = data.expiresAt ? new Date(data.expiresAt) : null
      if (expiresAt && expiresAt <= new Date()) {
        return { ok: false, error: 'Termin ważności musi być w przyszłości.' }
      }
    }
    // Paramedics never have a specialization (shown as "nd.").
    const specialization = isParamedic(existing.profession)
      ? null
      : data.specialization || null
    await purgeTrashedClash(data.pesel, data.pwz, context.identity, data.id)
    await db
      .update(practitioners)
      .set({
        pesel: data.pesel,
        pwz: data.pwz,
        specialization,
        status: data.status,
        expiresAt,
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
    const before = existing.expiresAt ? existing.expiresAt.toISOString() : null
    const after = expiresAt ? expiresAt.toISOString() : null
    if (before !== after) {
      changes.push(`ważność: ${validityLabel(before)} → ${validityLabel(after)}`)
    }
    if (changes.length) {
      await saveRevision(existing, context.identity, changes.join('; '))
    }
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'update',
      target: `${existing.firstName} ${existing.lastName} (PWZ ${data.pwz})`,
      details: changes.length ? changes.join('; ') : 'bez zmian',
    })
    if (existing.pesel !== data.pesel) {
      await raiseAlert({
        kind: 'pesel_changed',
        identity: context.identity,
        details: `${context.identity} zmienił(a) PESEL wpisu ${existing.firstName} ${existing.lastName}: ${existing.pesel} → ${data.pesel}.`,
      })
    }
    if (toStatus(existing.status) !== data.status) {
      await recordEvent({ kind: 'status_change', identity: context.identity })
      const changed = await countEvents({
        kind: 'status_change',
        identity: context.identity,
        minutes: 10,
      })
      if (changed >= 10) {
        await raiseAlert({
          kind: 'mass_status',
          identity: context.identity,
          details: `${context.identity} zmienił(a) status ${changed} wpisów w ciągu 10 minut.`,
          dedupeMinutes: 30,
        })
      }
    }
    return { ok: true }
  })

/** Admin only: moves an entry to the trash (it can be restored for TRASH_RETENTION_DAYS days). */
export const deletePractitioner = createServerFn({ method: 'POST' })
  .middleware([requireAdmin, needs('entries.trash')])
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
    await recordEvent({ kind: 'entry_delete', identity: context.identity })
    const deleted = await countEvents({
      kind: 'entry_delete',
      identity: context.identity,
      minutes: 10,
    })
    if (deleted >= 5) {
      await raiseAlert({
        kind: 'mass_delete',
        identity: context.identity,
        details: `${context.identity} usunął(-ęła) ${deleted} wpisów w ciągu 10 minut.`,
        dedupeMinutes: 30,
      })
    }
    return { ok: true }
  })

// ---------------------------------------------------------------------------
// Badges (staff only) and the public verification behind their QR code
// ---------------------------------------------------------------------------

/** Staff only: everything printed on a badge (including the PESEL). */
export const getBadge = createServerFn({ method: 'GET' })
  .middleware([requireStaff, needs('badges.view')])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data, context }) => {
    const [row] = await db
      .select()
      .from(practitioners)
      .where(and(eq(practitioners.id, data.id), alive))
      .limit(1)
    if (!row) return null
    if (await peselQuotaExceeded(context.identity)) throw new Error(PESEL_QUOTA_MESSAGE)
    await logPeselView({
      actor: context.identity,
      actorRole: context.isAdmin ? ROLE_ADMIN : ROLE_MANAGEMENT,
      target: `${row.firstName} ${row.lastName} (PWZ ${row.pwz})`,
      purpose: 'plakietka',
      entryId: row.id,
    })
    return {
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      pesel: row.pesel,
      pwz: row.pwz,
      profession: row.profession,
      status: effectiveStatus(toStatus(row.status), row.expiresAt),
      entryNumber: entryNumber(row.id),
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    }
  })

export type VerifyResult =
  | {
      status: 'valid'
      firstName: string
      lastName: string
      profession: string
      pwz: string
      expiresAt: string | null
    }
  | { status: 'suspended' | 'inactive' | 'not_found' | 'limited'; pwz: string }
  | { status: 'closed'; pwz: string; message: string }

/** Public: is the entry behind a badge real and current? Only active entries are "valid". */
export const verifyEntry = createServerFn({ method: 'GET' })
  .validator(z.object({ pwz: z.string().regex(/^\d{7}$/) }))
  .handler(async ({ data }): Promise<VerifyResult> => {
    const maintenance = await readMaintenance()
    if (maintenance.closed) {
      return { status: 'closed', pwz: data.pwz, message: maintenance.message }
    }
    if (!(await readFlag(FLAG_KEYS.verify))) {
      return { status: 'closed', pwz: data.pwz, message: 'Weryfikacja kodów QR jest chwilowo wyłączona.' }
    }
    if (await ipBanned()) return { status: 'limited', pwz: data.pwz }
    await trackTraffic()
    if (!(await lookupAllowed())) return { status: 'limited', pwz: data.pwz }
    const [row] = await db
      .select()
      .from(practitioners)
      .where(and(eq(practitioners.pwz, data.pwz), alive))
      .limit(1)
    if (!row) {
      await noteMiss('qr_miss', 'qr_mass_check', 15, 'masowe sprawdzanie numerów z kodów QR')
      return { status: 'not_found', pwz: data.pwz }
    }
    const status = effectiveStatus(toStatus(row.status), row.expiresAt)
    if (status === 'suspended') return { status: 'suspended', pwz: data.pwz }
    if (status === 'expired') return { status: 'inactive', pwz: data.pwz }
    return {
      status: 'valid',
      firstName: row.firstName,
      lastName: row.lastName,
      profession: row.profession,
      pwz: row.pwz,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    }
  })

// ---------------------------------------------------------------------------
// Trash
// ---------------------------------------------------------------------------

/** Admin only: entries in the trash. Entries older than the retention period are purged first. */
export const listTrash = createServerFn({ method: 'GET' })
  .middleware([requireAdmin, needs('entries.trash')])
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
  .middleware([requireAdmin, needs('entries.trash')])
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
  .middleware([requireAdmin, needs('entries.trash')])
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
  .middleware([requireAdmin, needs('audit.view')])
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
      ip: row.ip,
    }))
  })

// ---------------------------------------------------------------------------
// Staff accounts: kierownictwo (any admin) and admin (owner account only)
// ---------------------------------------------------------------------------

const passwordSchema = newPasswordSchema

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Podaj poprawny adres e-mail')
  .max(200)

export type AccountRow = { id: string; email: string; isOwner: boolean }

/** Accounts that have exactly this role (`kierownictwo` rows never include admins). */
async function listAccounts(role: string): Promise<AccountRow[]> {
  const owner = superAdminEmail()
  const rows = await db
    .select({ id: users.id, email: users.email, roles: users.roles })
    .from(users)
    .orderBy(users.email)
  return rows
    .filter(
      (row) =>
        row.roles.includes(role) &&
        (role === ROLE_ADMIN || !row.roles.includes(ROLE_ADMIN)),
    )
    .map((row) => ({
      id: row.id,
      email: row.email,
      isOwner: owner !== '' && row.email === owner,
    }))
}

type AccountActor = { identity: string }

function errorText(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    parts.push(current.message)
    current = (current as Error & { cause?: unknown }).cause
  }
  return parts.join(' | ')
}

async function findAccount(id: string, role: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1)
  if (!row || !row.roles.includes(role)) return null
  if (role === ROLE_MANAGEMENT && row.roles.includes(ROLE_ADMIN)) return null
  return row
}

async function removeAccount(
  id: string,
  role: string,
  actor: AccountActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const label = role === ROLE_ADMIN ? 'administratora' : 'kierownictwa'
  try {
    const target = await findAccount(id, role)
    if (!target) return { ok: false, error: `To konto nie jest kontem ${label}.` }
    if (target.email === superAdminEmail()) {
      return { ok: false, error: 'Konta właściciela nie można usunąć.' }
    }
    await db.delete(mfaSessions).where(eq(mfaSessions.identity, target.email))
    await db.delete(users).where(eq(users.id, target.id)) // sessions go with it (cascade)
    await logEvent({
      actor: actor.identity,
      actorRole: ROLE_ADMIN,
      action: role === ROLE_ADMIN ? 'delete_admin' : 'delete_management',
      target: target.email,
      details: `Rola: ${role}`,
    })
    return { ok: true }
  } catch {
    return { ok: false, error: 'Nie udało się usunąć konta.' }
  }
}

async function resetAccountPassword(
  id: string,
  password: string,
  role: string,
  actor: AccountActor,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const label = role === ROLE_ADMIN ? 'administratora' : 'kierownictwa'
  try {
    const target = await findAccount(id, role)
    if (!target) return { ok: false, error: `To konto nie jest kontem ${label}.` }
    await db
      .update(users)
      .set({
        passwordHash: await hashPassword(password),
        weakPassword: isWeakPassword(password, target.email),
      })
      .where(eq(users.id, target.id))
    // Whoever knew the old password is signed out everywhere.
    await db.delete(authSessions).where(eq(authSessions.userId, target.id))
    await db.delete(mfaSessions).where(eq(mfaSessions.identity, target.email))
    await logEvent({
      actor: actor.identity,
      actorRole: ROLE_ADMIN,
      action: role === ROLE_ADMIN ? 'reset_admin_password' : 'reset_password',
      target: target.email,
      details: 'Hasło ustawione przez administratora',
    })
    return { ok: true }
  } catch {
    return { ok: false, error: 'Nie udało się ustawić hasła.' }
  }
}

export type AddAccountResult =
  | { ok: true; email: string }
  | { ok: false; error: string }

async function createAccount(
  input: { email: string; password: string },
  role: string,
  actor: AccountActor,
): Promise<AddAccountResult> {
  try {
    await db.insert(users).values({
      email: input.email,
      passwordHash: await hashPassword(input.password),
      weakPassword: isWeakPassword(input.password, input.email),
      roles: [role],
      createdBy: actor.identity,
    })
  } catch (error) {
    return {
      ok: false,
      error: /duplicate|unique|already/i.test(errorText(error))
        ? 'Konto z tym adresem e-mail już istnieje.'
        : 'Nie udało się utworzyć konta. Spróbuj ponownie.',
    }
  }
  await logEvent({
    actor: actor.identity,
    actorRole: ROLE_ADMIN,
    action: role === ROLE_ADMIN ? 'add_admin' : 'add_management',
    target: input.email,
    details: `Rola: ${role}`,
  })
  return { ok: true, email: input.email }
}

const idInput = z.object({ id: z.string().min(1).max(100) })
const accountInput = z.object({ email: emailSchema, password: passwordSchema })

// --- kierownictwo (any admin) ---------------------------------------------

export const listManagement = createServerFn({ method: 'GET' })
  .middleware([requireAdmin, needs('accounts.management')])
  .handler(async () => listAccounts(ROLE_MANAGEMENT))

export type DeleteManagementResult = { ok: true } | { ok: false; error: string }

/** Admin only: permanently deletes a `kierownictwo` account. Admin accounts are refused. */
export const deleteManagement = createServerFn({ method: 'POST' })
  .middleware([requireAdmin, needs('accounts.management')])
  .validator(idInput)
  .handler(
    async ({ data, context }): Promise<DeleteManagementResult> =>
      removeAccount(data.id, ROLE_MANAGEMENT, context),
  )

export type SetPasswordResult = { ok: true } | { ok: false; error: string }

/** Admin only: sets a new password for a `kierownictwo` account (admin accounts are refused). */
export const setManagementPassword = createServerFn({ method: 'POST' })
  .middleware([requireAdmin, needs('accounts.management')])
  .validator(z.object({ id: idInput.shape.id, password: passwordSchema }))
  .handler(
    async ({ data, context }): Promise<SetPasswordResult> =>
      resetAccountPassword(data.id, data.password, ROLE_MANAGEMENT, context),
  )

export type AddManagementResult = AddAccountResult

/** Admin only: creates an account that has the `kierownictwo` role. */
export const addManagement = createServerFn({ method: 'POST' })
  .middleware([requireAdmin, needs('accounts.management')])
  .validator(accountInput)
  .handler(
    async ({ data, context }): Promise<AddManagementResult> =>
      createAccount(data, ROLE_MANAGEMENT, context),
  )

// --- admin (owner account only) -------------------------------------------

/** Owner only: all admin accounts (the owner's own row is flagged). */
export const listAdmins = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .handler(async () => listAccounts(ROLE_ADMIN))

/** Owner only: creates an account that has the `admin` role. */
export const addAdmin = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(accountInput)
  .handler(
    async ({ data, context }): Promise<AddAccountResult> =>
      createAccount(data, ROLE_ADMIN, context),
  )

/** Owner only: permanently deletes an admin account (never the owner's own). */
export const deleteAdmin = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(idInput)
  .handler(
    async ({ data, context }): Promise<DeleteManagementResult> =>
      removeAccount(data.id, ROLE_ADMIN, context),
  )

/** Owner only: sets a new password for an admin account. */
export const setAdminPassword = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ id: idInput.shape.id, password: passwordSchema }))
  .handler(
    async ({ data, context }): Promise<SetPasswordResult> =>
      resetAccountPassword(data.id, data.password, ROLE_ADMIN, context),
  )

// ---------------------------------------------------------------------------
// History of one entry, undo, bulk actions (admin)
// ---------------------------------------------------------------------------

/** Admin only: the latest changes of one entry (newest first). */
export const entryHistory = createServerFn({ method: 'GET' })
  .middleware([requireAdmin, needs('entries.edit')])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const rows = await db
      .select()
      .from(entryRevisions)
      .where(eq(entryRevisions.entryId, data.id))
      .orderBy(desc(entryRevisions.id))
      .limit(20)
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      actor: row.actor,
      summary: row.summary,
    }))
  })

/** Admin only: restores the entry to how it was before its latest change. */
export const undoEntryChange = createServerFn({ method: 'POST' })
  .middleware([requireAdmin, needs('entries.edit')])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data, context }): Promise<UpdateResult> => {
    const [existing] = await db
      .select()
      .from(practitioners)
      .where(and(eq(practitioners.id, data.id), alive))
      .limit(1)
    if (!existing) return { ok: false, error: 'Nie znaleziono wpisu.' }
    const [revision] = await db
      .select()
      .from(entryRevisions)
      .where(eq(entryRevisions.entryId, data.id))
      .orderBy(desc(entryRevisions.id))
      .limit(1)
    if (!revision) return { ok: false, error: 'Ten wpis nie ma zmian do cofnięcia.' }
    const before = JSON.parse(revision.before) as Snapshot
    const [clash] = await db
      .select({ id: practitioners.id })
      .from(practitioners)
      .where(
        and(
          ne(practitioners.id, data.id),
          alive,
          or(eq(practitioners.pesel, before.pesel), eq(practitioners.pwz, before.pwz)),
        ),
      )
      .limit(1)
    if (clash) {
      return { ok: false, error: 'Nie można cofnąć: stary PESEL lub PWZ ma już inna osoba.' }
    }
    await db
      .update(practitioners)
      .set({
        pesel: before.pesel,
        pwz: before.pwz,
        specialization: before.specialization,
        status: before.status,
        expiresAt: before.expiresAt ? new Date(before.expiresAt) : null,
      })
      .where(eq(practitioners.id, data.id))
    await db.delete(entryRevisions).where(eq(entryRevisions.id, revision.id))
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'update',
      target: `${existing.firstName} ${existing.lastName} (PWZ ${before.pwz})`,
      details: `Cofnięto zmianę: ${revision.summary}`,
    })
    return { ok: true }
  })

const bulkInput = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(200),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('status'), status: z.enum(ENTRY_STATUS_KEYS) }),
    z.object({ type: z.literal('expiry'), expiresAt: z.string().datetime().nullable() }),
    z.object({ type: z.literal('delete') }),
  ]),
})

/** Admin only: one action on many entries (status, validity or the trash). */
export const bulkUpdateEntries = createServerFn({ method: 'POST' })
  .middleware([requireAdmin, needs('entries.bulk')])
  .validator(bulkInput)
  .handler(async ({ data, context }) => {
    const rows = await db
      .select()
      .from(practitioners)
      .where(and(inArray(practitioners.id, data.ids), alive))
    const action = data.action
    if (action.type === 'expiry' && action.expiresAt && new Date(action.expiresAt) <= new Date()) {
      return { ok: false as const, error: 'Termin ważności musi być w przyszłości.', done: 0 }
    }
    let done = 0
    for (const row of rows) {
      if (action.type === 'delete') {
        await db.update(practitioners).set({ deletedAt: sql`now()` }).where(eq(practitioners.id, row.id))
        done++
      } else if (action.type === 'status') {
        if (toStatus(row.status) === action.status) continue
        await saveRevision(row, context.identity, `status: ${ENTRY_STATUSES[toStatus(row.status)]} → ${ENTRY_STATUSES[action.status]}`)
        await db.update(practitioners).set({ status: action.status }).where(eq(practitioners.id, row.id))
        done++
      } else {
        const after = action.expiresAt ? new Date(action.expiresAt) : null
        await saveRevision(row, context.identity, `ważność: ${validityLabel(row.expiresAt ? row.expiresAt.toISOString() : null)} → ${validityLabel(after ? after.toISOString() : null)}`)
        await db.update(practitioners).set({ expiresAt: after }).where(eq(practitioners.id, row.id))
        done++
      }
    }
    const what =
      action.type === 'delete'
        ? 'przeniesiono do kosza'
        : action.type === 'status'
          ? `zmieniono status na „${ENTRY_STATUSES[action.status]}”`
          : `ustawiono ważność: ${validityLabel(action.expiresAt)}`
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: action.type === 'delete' ? 'delete' : 'update',
      target: `Zbiorczo: ${done} wpisów`,
      details: `Akcja zbiorcza: ${what}`,
    })
    if (action.type === 'delete' && done >= 5) {
      await raiseAlert({
        kind: 'mass_delete',
        identity: context.identity,
        details: `${context.identity} usunął(-ęła) zbiorczo ${done} wpisów.`,
        dedupeMinutes: 30,
      })
    }
    if (action.type === 'status' && done >= 10) {
      await raiseAlert({
        kind: 'mass_status',
        identity: context.identity,
        details: `${context.identity} zmienił(a) zbiorczo status ${done} wpisów.`,
        dedupeMinutes: 30,
      })
    }
    return { ok: true as const, done, error: null }
  })

/** Admin only: writes an export of entries to the audit log (the file itself is built in the browser). */
export const logEntriesExport = createServerFn({ method: 'POST' })
  .middleware([requireAdmin, needs('entries.export')])
  .validator(z.object({ count: z.number().int().min(1).max(5000) }))
  .handler(async ({ data, context }) => {
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'export',
      target: `Eksport do CSV: ${data.count} wpisów`,
      details: 'Plik zawiera numery PESEL',
    })
    return { ok: true as const }
  })
