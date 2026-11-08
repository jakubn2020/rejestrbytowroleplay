import { createServerFn } from '@tanstack/react-start'
import { desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import { reports } from '../../db/schema'
import { requireAdmin } from './auth-server'
import {
  clientIp,
  countEvents,
  notifyAdmins,
  recordEvent,
} from './security-server'

const REPORTS_PER_HOUR = 3

const reportInput = z.object({
  subject: z.string().trim().min(2, 'Podaj, którego wpisu dotyczy zgłoszenie').max(120),
  message: z
    .string()
    .trim()
    .min(10, 'Opisz błąd (co najmniej 10 znaków)')
    .max(1000, 'Opis może mieć najwyżej 1000 znaków'),
  contact: z.string().trim().max(100).optional(),
  /** Honeypot: real visitors never fill this in. */
  website: z.string().max(200).optional(),
})

export type ReportResult = { ok: true } | { ok: false; error: string }

/** Public: report a mistake in the registry (limited per address). */
export const submitReport = createServerFn({ method: 'POST' })
  .validator(reportInput)
  .handler(async ({ data }): Promise<ReportResult> => {
    if (data.website) return { ok: true } // bot: pretend it worked
    const ip = clientIp()
    if (ip) {
      const sent = await countEvents({ kind: 'report', ip, minutes: 60 })
      if (sent >= REPORTS_PER_HOUR) {
        return {
          ok: false,
          error: 'Wysłano już kilka zgłoszeń z tego adresu. Spróbuj ponownie za godzinę.',
        }
      }
    }
    await db.insert(reports).values({
      subject: data.subject,
      message: data.message,
      contact: data.contact || null,
    })
    await recordEvent({ kind: 'report', ip })
    await notifyAdmins(
      'Nowe zgłoszenie błędu w rejestrze',
      `Dotyczy: ${data.subject}\n\n${data.message}${data.contact ? `\n\nKontakt: ${data.contact}` : ''}`,
    )
    return { ok: true }
  })

/** Admin only: all reports, open ones first. */
export const listReports = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(async () => {
    const rows = await db
      .select()
      .from(reports)
      .orderBy(desc(sql`${reports.status} = 'open'`), desc(reports.createdAt))
      .limit(200)
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      subject: row.subject,
      message: row.message,
      contact: row.contact,
      status: row.status === 'done' ? ('done' as const) : ('open' as const),
      handledBy: row.handledBy,
    }))
  })

export type ReportRow = Awaited<ReturnType<typeof listReports>>[number]

export const setReportStatus = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(z.object({ id: z.number().int().positive(), status: z.enum(['open', 'done']) }))
  .handler(async ({ data, context }) => {
    await db
      .update(reports)
      .set(
        data.status === 'done'
          ? { status: 'done', handledBy: context.identity, handledAt: sql`now()` }
          : { status: 'open', handledBy: null, handledAt: null },
      )
      .where(eq(reports.id, data.id))
    return { ok: true }
  })

export const deleteReport = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    await db.delete(reports).where(eq(reports.id, data.id))
    return { ok: true }
  })
