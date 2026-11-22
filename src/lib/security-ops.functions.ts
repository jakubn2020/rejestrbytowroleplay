import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import {
  auditLog,
  authSessions,
  backups,
  incidentNotes,
  incidents,
  mfaSessions,
  practitioners,
  securityEvents,
  users,
} from '../../db/schema'
import { requireSuperAdmin } from './auth-server'
import { INCIDENT_CHECKLIST, INCIDENT_PLAN } from './incident-plan'
import { ROLE_ADMIN, formatDateTime } from './registry'
import { AUTH_COOKIE } from './session-server'
import {
  MFA_COOKIE,
  logEvent,
  notifyAdmins,
  raiseAlert,
  readCookie,
  sha256,
} from './security-server'
import {
  SEC_KEYS,
  readMaintenance,
  readSecuritySettings,
  writeMaintenance,
  writeSetting,
  type SecuritySettings,
} from './site-settings-server'

// ---------------------------------------------------------------------------
// Settings (sliders)
// ---------------------------------------------------------------------------

export const getSecuritySettings = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .handler(async (): Promise<SecuritySettings> => readSecuritySettings())

export const saveSecuritySettings = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(
    z.object({
      peselThreshold: z.number().int().min(3).max(200),
      peselDailyLimit: z.number().int().min(0).max(500),
      maxSessions: z.number().int().min(0).max(20),
      unusedDays: z.number().int().min(0).max(365),
    }),
  )
  .handler(async ({ data, context }) => {
    await writeSetting(SEC_KEYS.peselThreshold, String(data.peselThreshold))
    await writeSetting(SEC_KEYS.peselDailyLimit, String(data.peselDailyLimit))
    await writeSetting(SEC_KEYS.maxSessions, String(data.maxSessions))
    await writeSetting(SEC_KEYS.unusedDays, String(data.unusedDays))
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'security_settings',
      target: 'Ustawienia bezpieczeństwa',
      details: `Próg alertu PESEL: ${data.peselThreshold}/10 min; limit dzienny PESEL: ${data.peselDailyLimit || 'brak'}; sesje na konto: ${data.maxSessions || 'bez limitu'}; blokada nieużywanych kont: ${data.unusedDays ? `${data.unusedDays} dni` : 'wyłączona'}`,
    })
    return { ok: true as const }
  })

// ---------------------------------------------------------------------------
// Security score
// ---------------------------------------------------------------------------

export type ScoreItem = { label: string; ok: boolean; weight: number; hint: string }

/** Owner only: a 0–100 score with the list of what is missing. */
export const getSecurityScore = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .handler(async (): Promise<{ score: number; items: ScoreItem[] }> => {
    const settings = await readSecuritySettings()
    const [weak] = await db
      .select({ n: sql<string>`count(*)` })
      .from(users)
      .where(eq(users.weakPassword, true))
    const [alerts] = await db
      .select({ n: sql<string>`count(*)` })
      .from(securityEvents)
      .where(
        and(
          eq(securityEvents.isAlert, true),
          eq(securityEvents.acknowledged, false),
          sql`${securityEvents.severity} in ('high','critical')`,
        ),
      )
    const [backup] = await db
      .select({ at: backups.createdAt })
      .from(backups)
      .orderBy(desc(backups.createdAt))
      .limit(1)
    const [failed] = await db
      .select({ n: sql<string>`count(*)` })
      .from(securityEvents)
      .where(
        and(
          eq(securityEvents.kind, 'login_failed'),
          gt(securityEvents.createdAt, sql`now() - interval '24 hours'`),
        ),
      )
    const weakCount = Number(weak?.n ?? 0)
    const openAlerts = Number(alerts?.n ?? 0)
    const items: ScoreItem[] = [
      {
        label: 'Kody z e-maila przy logowaniu (Resend)',
        ok: Boolean(process.env.RESEND_API_KEY),
        weight: 15,
        hint: 'Ustaw RESEND_API_KEY, aby logowanie wymagało kodu z e-maila i aby szły powiadomienia.',
      },
      {
        label: 'Brak słabych haseł kont',
        ok: weakCount === 0,
        weight: 15,
        hint: `Kont ze słabym hasłem: ${weakCount}. Wymuś zmianę hasła w zakładce „Konta”.`,
      },
      {
        label: 'Brak nieprzejrzanych alertów wysokiej wagi',
        ok: openAlerts === 0,
        weight: 15,
        hint: `Otwartych alertów wysokich i krytycznych: ${openAlerts}.`,
      },
      {
        label: 'Kopia zapasowa z ostatnich 7 dni',
        ok: Boolean(backup && Date.now() - backup.at.getTime() < 7 * 86_400_000),
        weight: 15,
        hint: 'Zrób kopię zapasową rejestru w zakładce „Dane”.',
      },
      {
        label: 'Automatyczna blokada nieużywanych kont',
        ok: settings.unusedDays > 0,
        weight: 10,
        hint: 'Ustaw liczbę dni nieaktywności w ustawieniach (suwak).',
      },
      {
        label: 'Limit jednoczesnych sesji na konto',
        ok: settings.maxSessions > 0,
        weight: 5,
        hint: 'Ustaw limit sesji w ustawieniach.',
      },
      {
        label: 'Alert masowego odsłaniania PESEL ustawiony ostro (do 20)',
        ok: settings.peselThreshold <= 20,
        weight: 5,
        hint: 'Obniż próg alertu odsłonięć PESEL.',
      },
      {
        label: 'Dzienny limit odsłonięć PESEL',
        ok: settings.peselDailyLimit > 0,
        weight: 10,
        hint: 'Ustaw dzienny limit odsłonięć PESEL na konto.',
      },
      {
        label: 'Biała lista adresów dla panelu admina',
        ok: settings.whitelist,
        weight: 5,
        hint: 'Opcjonalne: dopuść do panelu admina tylko wybrane adresy IP.',
      },
      {
        label: 'Mało nieudanych logowań (poniżej 20 w 24 h)',
        ok: Number(failed?.n ?? 0) < 20,
        weight: 5,
        hint: `Nieudanych logowań w ostatniej dobie: ${failed?.n ?? 0}.`,
      },
    ]
    const total = items.reduce((sum, item) => sum + item.weight, 0)
    const earned = items.filter((item) => item.ok).reduce((sum, item) => sum + item.weight, 0)
    return { score: Math.round((earned / total) * 100), items }
  })

// ---------------------------------------------------------------------------
// Test alarm, PESEL view log
// ---------------------------------------------------------------------------

/** Owner only: raises a harmless test alert (also e-mailed when e-mail is configured). */
export const sendTestAlert = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .handler(async ({ context }) => {
    await raiseAlert({
      kind: 'test',
      identity: context.identity,
      details: `Alarm próbny uruchomiony przez ${context.identity}. Jeśli to widzisz, alerty działają.`,
      severity: 'low',
    })
    return { ok: true as const }
  })

export type PeselViewRow = {
  id: number
  createdAt: string
  actor: string
  actorRole: string
  target: string | null
  purpose: string | null
  ip: string | null
}

/** Owner only: who looked at whose PESEL (the last 200 reveals). */
export const listPeselViews = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .handler(async (): Promise<PeselViewRow[]> => {
    const rows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'pesel_view'))
      .orderBy(desc(auditLog.createdAt))
      .limit(200)
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      actor: row.actor,
      actorRole: row.actorRole,
      target: row.target,
      purpose: row.details,
      ip: row.ip,
    }))
  })

// ---------------------------------------------------------------------------
// Incidents, lockdown
// ---------------------------------------------------------------------------

async function freezeEvidence(): Promise<string> {
  const audit = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(500)
  const events = await db.select().from(securityEvents).orderBy(desc(securityEvents.createdAt)).limit(300)
  return JSON.stringify({ takenAt: new Date().toISOString(), audit, events })
}

async function openIncident(identity: string, title: string): Promise<number> {
  const [row] = await db
    .insert(incidents)
    .values({ createdBy: identity, title, snapshot: await freezeEvidence() })
    .returning({ id: incidents.id })
  await logEvent({
    actor: identity,
    actorRole: ROLE_ADMIN,
    action: 'incident',
    target: title,
    details: `Otwarto incydent nr ${row.id}; zamrożono dowody (dziennik i zdarzenia)`,
  })
  return row.id
}

async function note(incidentId: number, author: string, text: string) {
  await db.insert(incidentNotes).values({ incidentId, author, text })
}

async function signOutOthers() {
  const keepAuth = readCookie(AUTH_COOKIE)
  const keepMfa = readCookie(MFA_COOKIE)
  await db
    .delete(mfaSessions)
    .where(keepMfa ? ne(mfaSessions.tokenHash, sha256(keepMfa)) : undefined)
  await db
    .delete(authSessions)
    .where(keepAuth ? ne(authSessions.tokenHash, sha256(keepAuth)) : undefined)
}

export type EmergencyState = { lockdown: boolean; closed: boolean }

export const getEmergencyState = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .handler(async (): Promise<EmergencyState> => {
    const settings = await readSecuritySettings()
    const maintenance = await readMaintenance()
    return { lockdown: settings.lockdown, closed: maintenance.closed }
  })

/**
 * Owner only. "close" closes the registry and signs everybody out; "lockdown" additionally lets
 * only the owner sign in. Both open an incident with frozen evidence.
 */
export const activateEmergency = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(
    z.object({
      mode: z.enum(['close', 'lockdown']),
      reason: z.string().trim().max(300).optional(),
    }),
  )
  .handler(async ({ data, context }): Promise<{ incidentId: number }> => {
    const reason = data.reason || 'Zabezpieczenie rejestru przez właściciela'
    const title = data.mode === 'lockdown' ? `Lockdown: ${reason}` : `Zamknięcie rejestru: ${reason}`
    const incidentId = await openIncident(context.identity, title)
    await writeMaintenance(true, 'Rejestr jest chwilowo zamknięty z powodów bezpieczeństwa. Spróbuj ponownie później.')
    if (data.mode === 'lockdown') await writeSetting(SEC_KEYS.lockdown, '1')
    await signOutOthers()
    await note(
      incidentId,
      context.identity,
      data.mode === 'lockdown'
        ? 'Włączono lockdown: rejestr zamknięty, wszyscy wylogowani, logować może się tylko właściciel.'
        : 'Zamknięto rejestr i wylogowano wszystkich użytkowników.',
    )
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'lockdown',
      target: data.mode === 'lockdown' ? 'Lockdown' : 'Zamknięcie i wylogowanie',
      details: reason,
    })
    await raiseAlert({
      kind: 'lockdown',
      identity: context.identity,
      details: `${context.identity} ${data.mode === 'lockdown' ? 'włączył(a) tryb blokady (lockdown)' : 'zamknął(-ęła) rejestr i wylogował(a) wszystkich'}: ${reason}`,
      severity: 'critical',
    })
    await notifyAdmins('Rejestr zabezpieczony', `Powód: ${reason}`)
    return { incidentId }
  })

/** Owner only: ends lockdown and (optionally) reopens the registry for visitors. */
export const deactivateEmergency = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ reopen: z.boolean() }))
  .handler(async ({ data, context }) => {
    await writeSetting(SEC_KEYS.lockdown, '0')
    if (data.reopen) await writeMaintenance(false, '')
    const open = await db
      .select({ id: incidents.id })
      .from(incidents)
      .where(eq(incidents.status, 'open'))
    for (const incident of open) {
      await note(
        incident.id,
        context.identity,
        `Wyłączono lockdown${data.reopen ? ' i otwarto rejestr dla odwiedzających' : ''}.`,
      )
    }
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'lockdown',
      target: 'Koniec blokady',
      details: data.reopen ? 'Lockdown wyłączony, rejestr otwarty' : 'Lockdown wyłączony (rejestr nadal zamknięty)',
    })
    return { ok: true as const }
  })

export type IncidentRow = {
  id: number
  title: string
  status: string
  createdBy: string
  createdAt: string
  closedAt: string | null
  notes: number
}

export const listIncidents = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .handler(async (): Promise<IncidentRow[]> => {
    const rows = await db
      .select({
        id: incidents.id,
        title: incidents.title,
        status: incidents.status,
        createdBy: incidents.createdBy,
        createdAt: incidents.createdAt,
        closedAt: incidents.closedAt,
        notes: sql<string>`(select count(*) from incident_notes n where n.incident_id = ${incidents.id})`,
      })
      .from(incidents)
      .orderBy(desc(incidents.createdAt))
      .limit(50)
    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      closedAt: row.closedAt ? row.closedAt.toISOString() : null,
      notes: Number(row.notes),
    }))
  })

export const createIncident = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ title: z.string().trim().min(3).max(150) }))
  .handler(async ({ data, context }) => ({
    id: await openIncident(context.identity, data.title),
  }))

export type IncidentDetails = {
  incident: IncidentRow
  notes: { id: number; createdAt: string; author: string; text: string }[]
  checklist: string[]
}

export const getIncident = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }): Promise<IncidentDetails | null> => {
    const [row] = await db.select().from(incidents).where(eq(incidents.id, data.id)).limit(1)
    if (!row) return null
    const notes = await db
      .select()
      .from(incidentNotes)
      .where(eq(incidentNotes.incidentId, data.id))
      .orderBy(incidentNotes.createdAt)
    let checklist: string[] = []
    try {
      const parsed: unknown = JSON.parse(row.checklist)
      if (Array.isArray(parsed)) checklist = parsed.filter((x): x is string => typeof x === 'string')
    } catch {
      checklist = []
    }
    return {
      incident: {
        id: row.id,
        title: row.title,
        status: row.status,
        createdBy: row.createdBy,
        createdAt: row.createdAt.toISOString(),
        closedAt: row.closedAt ? row.closedAt.toISOString() : null,
        notes: notes.length,
      },
      notes: notes.map((n) => ({
        id: n.id,
        createdAt: n.createdAt.toISOString(),
        author: n.author,
        text: n.text,
      })),
      checklist,
    }
  })

export const addIncidentNote = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ id: z.number().int().positive(), text: z.string().trim().min(1).max(1000) }))
  .handler(async ({ data, context }) => {
    await note(data.id, context.identity, data.text)
    return { ok: true as const }
  })

export const setIncidentChecklist = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ id: z.number().int().positive(), items: z.array(z.string()).max(30) }))
  .handler(async ({ data }) => {
    const known = new Set(INCIDENT_CHECKLIST.map((item) => item.id))
    const items = data.items.filter((id) => known.has(id))
    await db.update(incidents).set({ checklist: JSON.stringify(items) }).where(eq(incidents.id, data.id))
    return { ok: true as const }
  })

export const closeIncident = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data, context }) => {
    await db
      .update(incidents)
      .set({ status: 'closed', closedAt: sql`now()` })
      .where(eq(incidents.id, data.id))
    await note(data.id, context.identity, 'Incydent zamknięty.')
    return { ok: true as const }
  })

/** Owner only: the frozen evidence of an incident (JSON text for download). */
export const getIncidentSnapshot = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const [row] = await db
      .select({ snapshot: incidents.snapshot })
      .from(incidents)
      .where(eq(incidents.id, data.id))
      .limit(1)
    return { snapshot: row?.snapshot ?? '' }
  })

/** Owner only: the final report of an incident as Markdown text. */
export const getIncidentReport = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const [row] = await db.select().from(incidents).where(eq(incidents.id, data.id)).limit(1)
    if (!row) return { report: '' }
    const notes = await db
      .select()
      .from(incidentNotes)
      .where(eq(incidentNotes.incidentId, data.id))
      .orderBy(incidentNotes.createdAt)
    let done: string[] = []
    try {
      const parsed: unknown = JSON.parse(row.checklist)
      if (Array.isArray(parsed)) done = parsed.filter((x): x is string => typeof x === 'string')
    } catch {
      done = []
    }
    let audit = 0
    let events = 0
    try {
      const snap = JSON.parse(row.snapshot ?? '{}') as { audit?: unknown[]; events?: unknown[] }
      audit = snap.audit?.length ?? 0
      events = snap.events?.length ?? 0
    } catch {
      // no snapshot
    }
    const when = (d: Date) => formatDateTime(d.toISOString())
    const lines = [
      `# Raport z incydentu nr ${row.id}: ${row.title}`,
      '',
      `- Otwarty: ${when(row.createdAt)} (${row.createdBy})`,
      `- Status: ${row.status === 'closed' ? `zamknięty ${row.closedAt ? when(row.closedAt) : ''}` : 'otwarty'}`,
      `- Zamrożone dowody: ${audit} wpisów dziennika, ${events} zdarzeń bezpieczeństwa`,
      '',
      '## Oś czasu',
      '',
      ...(notes.length ? notes.map((n) => `- ${when(n.createdAt)} — ${n.author}: ${n.text}`) : ['- (brak notatek)']),
      '',
      '## Lista kontrolna po incydencie',
      '',
      ...INCIDENT_CHECKLIST.map((item) => `- [${done.includes(item.id) ? 'x' : ' '}] ${item.label}`),
      '',
      '## Plan reakcji',
      '',
      ...INCIDENT_PLAN.map((step, i) => `${i + 1}. ${step}`),
      '',
    ]
    return { report: lines.join('\n') }
  })

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

type BackupEntry = {
  pesel: string
  pwz: string
  firstName: string
  lastName: string
  profession: string
  specialization: string | null
  createdBy: string | null
  status: string
  createdAt: string
  expiresAt: string | null
}

async function makeBackup(identity: string): Promise<number> {
  const rows = await db.select().from(practitioners).where(isNull(practitioners.deletedAt))
  const entries: BackupEntry[] = rows.map((row) => ({
    pesel: row.pesel,
    pwz: row.pwz,
    firstName: row.firstName,
    lastName: row.lastName,
    profession: row.profession,
    specialization: row.specialization,
    createdBy: row.createdBy,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  }))
  const [saved] = await db
    .insert(backups)
    .values({ createdBy: identity, entries: entries.length, data: JSON.stringify({ version: 1, entries }) })
    .returning({ id: backups.id })
  // Keep the ten newest.
  const old = await db.select({ id: backups.id }).from(backups).orderBy(desc(backups.createdAt)).offset(10)
  for (const b of old) await db.delete(backups).where(eq(backups.id, b.id))
  await logEvent({
    actor: identity,
    actorRole: ROLE_ADMIN,
    action: 'backup',
    target: `Kopia nr ${saved.id}`,
    details: `Wpisów w kopii: ${entries.length}`,
  })
  return saved.id
}

export type BackupRow = { id: number; createdAt: string; createdBy: string; entries: number }

export const listBackups = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .handler(async (): Promise<BackupRow[]> => {
    const rows = await db
      .select({ id: backups.id, createdAt: backups.createdAt, createdBy: backups.createdBy, entries: backups.entries })
      .from(backups)
      .orderBy(desc(backups.createdAt))
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }))
  })

export const createBackup = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .handler(async ({ context }) => ({ id: await makeBackup(context.identity) }))

export const downloadBackup = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const [row] = await db.select({ data: backups.data }).from(backups).where(eq(backups.id, data.id)).limit(1)
    return { data: row?.data ?? '' }
  })

/**
 * Owner only: puts the entries of a backup back. Entries are matched by PESEL: missing ones are
 * added, existing ones get the data from the backup. Nothing is deleted. A fresh backup of the
 * current state is made first.
 */
export const restoreBackup = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data, context }) => {
    const [row] = await db.select({ data: backups.data }).from(backups).where(eq(backups.id, data.id)).limit(1)
    if (!row) return { ok: false as const, error: 'Nie znaleziono kopii.' }
    let entries: BackupEntry[]
    try {
      entries = (JSON.parse(row.data) as { entries: BackupEntry[] }).entries
    } catch {
      return { ok: false as const, error: 'Kopia jest uszkodzona.' }
    }
    await makeBackup(context.identity)
    let restored = 0
    let failed = 0
    for (const entry of entries) {
      try {
        await db
          .insert(practitioners)
          .values({
            pesel: entry.pesel,
            pwz: entry.pwz,
            firstName: entry.firstName,
            lastName: entry.lastName,
            profession: entry.profession,
            specialization: entry.specialization,
            createdBy: entry.createdBy,
            status: entry.status,
            createdAt: new Date(entry.createdAt),
            expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : null,
            deletedAt: null,
          })
          .onConflictDoUpdate({
            target: practitioners.pesel,
            set: {
              pwz: entry.pwz,
              firstName: entry.firstName,
              lastName: entry.lastName,
              profession: entry.profession,
              specialization: entry.specialization,
              status: entry.status,
              expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : null,
              deletedAt: null,
            },
          })
        restored++
      } catch {
        failed++
      }
    }
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'restore',
      target: `Kopia nr ${data.id}`,
      details: `Przywrócono lub zaktualizowano ${restored} wpisów, błędy: ${failed}`,
    })
    return { ok: true as const, restored, failed }
  })
