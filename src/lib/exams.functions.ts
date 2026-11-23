import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db'
import {
  examEvents,
  examParticipants,
  examQuestions,
  examSessions,
  exams,
} from '../../db/schema'
// Beta: only the owner. Later this becomes "lecturer or examiner" (roles added by an admin).
import { requireSuperAdmin as requireExamStaff } from './auth-server'
import {
  autoLogins,
  generateQuestionsWithAi,
  parseJsonRecord,
  randomToken,
  summarize,
  type StoredQuestion,
} from './exams-server'

// ---------------------------------------------------------------------------
// Exams and questions
// ---------------------------------------------------------------------------

export type ExamListRow = {
  id: number
  title: string
  createdAt: string
  createdBy: string
  durationMinutes: number
  questionCount: number
}

export const listExams = createServerFn({ method: 'GET' })
  .middleware([requireExamStaff])
  .handler(async (): Promise<ExamListRow[]> => {
    const rows = await db.select().from(exams).orderBy(desc(exams.id))
    const counts = await db
      .select({ examId: examQuestions.examId, n: sql<string>`count(*)` })
      .from(examQuestions)
      .where(eq(examQuestions.version, 'A'))
      .groupBy(examQuestions.examId)
    const byExam = new Map(counts.map((c) => [c.examId, Number(c.n)]))
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
      durationMinutes: row.durationMinutes,
      questionCount: byExam.get(row.id) ?? 0,
    }))
  })

const createInput = z.object({
  title: z.string().trim().min(1, 'Podaj tytuł').max(120),
  topic: z.string().trim().max(4000),
  hasPdf: z.boolean(),
  durationMinutes: z.number().int().min(5).max(300),
  passPercent: z.number().int().min(1).max(100),
})

export type CreateExamResult = { ok: true; id: number } | { ok: false; error: string }

/** Step 1: creates the empty exam. The questions come from `generatePart`, called one batch at a time. */
export const createExam = createServerFn({ method: 'POST' })
  .middleware([requireExamStaff])
  .validator(createInput)
  .handler(async ({ data, context }): Promise<CreateExamResult> => {
    if (!data.topic && !data.hasPdf) return { ok: false, error: 'Opisz zagadnienia albo dołącz plik PDF.' }
    const [exam] = await db
      .insert(exams)
      .values({
        createdBy: context.identity,
        title: data.title,
        topic: data.topic || '(plik PDF)',
        durationMinutes: data.durationMinutes,
        passPercent: data.passPercent,
      })
      .returning({ id: exams.id })
    return { ok: true, id: exam.id }
  })

export type PartResult = { ok: true; added: number } | { ok: false; error: string }

/**
 * Step 2 (repeated): one small AI request for one version. Every call is a separate request with
 * its own time limit, so even a big exam never runs into the platform's timeout.
 */
export const generatePart = createServerFn({ method: 'POST' })
  .middleware([requireExamStaff])
  .validator(
    z
      .object({
        examId: z.number().int().positive(),
        version: z.enum(['A', 'B', 'C']),
        topic: z.string().trim().max(4000),
        pdfBase64: z.string().max(7_000_000).optional(),
        nAbcde: z.number().int().min(0).max(30),
        nTf: z.number().int().min(0).max(30),
        nOpen: z.number().int().min(0).max(15),
      })
      .refine((v) => v.nAbcde + v.nTf + v.nOpen > 0),
  )
  .handler(async ({ data }): Promise<PartResult> => {
    let questions
    try {
      questions = await generateQuestionsWithAi(data)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Nie udało się wygenerować pytań.' }
    }
    const [last] = await db
      .select({ position: examQuestions.position })
      .from(examQuestions)
      .where(and(eq(examQuestions.examId, data.examId), eq(examQuestions.version, data.version)))
      .orderBy(desc(examQuestions.position))
      .limit(1)
    const start = (last?.position ?? -1) + 1
    await db.insert(examQuestions).values(
      questions.map((q, index) => ({
        examId: data.examId,
        version: data.version,
        position: start + index,
        kind: q.kind,
        prompt: q.prompt,
        options: JSON.stringify(q.options),
        correct: q.correct,
        points: q.points,
      })),
    )
    return { ok: true, added: questions.length }
  })

export type ExamDetail = {
  id: number
  title: string
  topic: string
  durationMinutes: number
  passPercent: number
  questions: {
    id: number
    version: string
    position: number
    kind: 'abcde' | 'tf' | 'open'
    prompt: string
    options: string[]
    correct: string
    points: number
  }[]
}

export const getExam = createServerFn({ method: 'GET' })
  .middleware([requireExamStaff])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }): Promise<ExamDetail | null> => {
    const [exam] = await db.select().from(exams).where(eq(exams.id, data.id)).limit(1)
    if (!exam) return null
    const questions = await db
      .select()
      .from(examQuestions)
      .where(eq(examQuestions.examId, exam.id))
      .orderBy(asc(examQuestions.version), asc(examQuestions.position), asc(examQuestions.id))
    return {
      id: exam.id,
      title: exam.title,
      topic: exam.topic,
      durationMinutes: exam.durationMinutes,
      passPercent: exam.passPercent,
      questions: questions.map((q) => ({
        id: q.id,
        version: q.version,
        position: q.position,
        kind: q.kind as 'abcde' | 'tf' | 'open',
        prompt: q.prompt,
        options: JSON.parse(q.options) as string[],
        correct: q.correct,
        points: q.points,
      })),
    }
  })

export const updateExam = createServerFn({ method: 'POST' })
  .middleware([requireExamStaff])
  .validator(
    z.object({
      id: z.number().int().positive(),
      title: z.string().trim().min(1).max(120),
      durationMinutes: z.number().int().min(5).max(300),
      passPercent: z.number().int().min(1).max(100),
    }),
  )
  .handler(async ({ data }) => {
    await db
      .update(exams)
      .set({ title: data.title, durationMinutes: data.durationMinutes, passPercent: data.passPercent })
      .where(eq(exams.id, data.id))
    return { ok: true as const }
  })

const questionInput = z
  .object({
    kind: z.enum(['abcde', 'tf', 'open']),
    prompt: z.string().trim().min(3, 'Wpisz treść pytania').max(1500),
    options: z.array(z.string().trim().max(500)).max(5),
    correct: z.string().max(2000),
    points: z.number().int().min(1).max(20),
  })
  .superRefine((q, ctx) => {
    if (q.kind === 'abcde') {
      if (q.options.length !== 5 || q.options.some((o) => !o)) {
        ctx.addIssue({ code: 'custom', message: 'Pytanie zamknięte musi mieć 5 niepustych odpowiedzi' })
      }
      if (!/^[0-4]$/.test(q.correct)) ctx.addIssue({ code: 'custom', message: 'Wskaż poprawną odpowiedź' })
    }
    if (q.kind === 'tf' && q.correct !== 'true' && q.correct !== 'false') {
      ctx.addIssue({ code: 'custom', message: 'Wybierz prawda albo fałsz' })
    }
  })

export type QuestionResult = { ok: true } | { ok: false; error: string }

export const saveQuestion = createServerFn({ method: 'POST' })
  .middleware([requireExamStaff])
  .validator(
    z.object({
      examId: z.number().int().positive(),
      /** Existing question to change; without it a new question is added to `version`. */
      id: z.number().int().positive().optional(),
      version: z.enum(['A', 'B', 'C']),
      question: questionInput,
    }),
  )
  .handler(async ({ data }): Promise<QuestionResult> => {
    const q = data.question
    const values = {
      kind: q.kind,
      prompt: q.prompt,
      options: JSON.stringify(q.kind === 'abcde' ? q.options : []),
      correct: q.correct,
      points: q.points,
    }
    if (data.id) {
      await db
        .update(examQuestions)
        .set(values)
        .where(and(eq(examQuestions.id, data.id), eq(examQuestions.examId, data.examId)))
    } else {
      const [last] = await db
        .select({ position: examQuestions.position })
        .from(examQuestions)
        .where(and(eq(examQuestions.examId, data.examId), eq(examQuestions.version, data.version)))
        .orderBy(desc(examQuestions.position))
        .limit(1)
      await db.insert(examQuestions).values({
        examId: data.examId,
        version: data.version,
        position: (last?.position ?? -1) + 1,
        ...values,
      })
    }
    return { ok: true }
  })

export const deleteQuestion = createServerFn({ method: 'POST' })
  .middleware([requireExamStaff])
  .validator(z.object({ id: z.number().int().positive(), examId: z.number().int().positive() }))
  .handler(async ({ data }) => {
    await db.delete(examQuestions).where(and(eq(examQuestions.id, data.id), eq(examQuestions.examId, data.examId)))
    return { ok: true as const }
  })

export const deleteExam = createServerFn({ method: 'POST' })
  .middleware([requireExamStaff])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const sessions = await db.select({ id: examSessions.id }).from(examSessions).where(eq(examSessions.examId, data.id))
    const sessionIds = sessions.map((s) => s.id)
    if (sessionIds.length) {
      const people = await db
        .select({ id: examParticipants.id })
        .from(examParticipants)
        .where(inArray(examParticipants.sessionId, sessionIds))
      const peopleIds = people.map((p) => p.id)
      if (peopleIds.length) await db.delete(examEvents).where(inArray(examEvents.participantId, peopleIds))
      await db.delete(examParticipants).where(inArray(examParticipants.sessionId, sessionIds))
      await db.delete(examSessions).where(inArray(examSessions.id, sessionIds))
    }
    await db.delete(examQuestions).where(eq(examQuestions.examId, data.id))
    await db.delete(exams).where(eq(exams.id, data.id))
    return { ok: true as const }
  })

// ---------------------------------------------------------------------------
// Test sessions: one-time link, list of logins, start and monitoring
// ---------------------------------------------------------------------------

export type SessionListRow = {
  id: number
  examId: number
  examTitle: string
  createdAt: string
  status: 'lobby' | 'running' | 'finished'
  participants: number
}

function effectiveStatus(row: { status: string; endsAt: Date | null }): 'lobby' | 'running' | 'finished' {
  if (row.status === 'running' && row.endsAt && row.endsAt.getTime() < Date.now()) return 'finished'
  return row.status as 'lobby' | 'running' | 'finished'
}

export const listSessions = createServerFn({ method: 'GET' })
  .middleware([requireExamStaff])
  .handler(async (): Promise<SessionListRow[]> => {
    const rows = await db
      .select({ session: examSessions, title: exams.title })
      .from(examSessions)
      .innerJoin(exams, eq(exams.id, examSessions.examId))
      .orderBy(desc(examSessions.id))
      .limit(30)
    const counts = rows.length
      ? await db
          .select({ sessionId: examParticipants.sessionId, n: sql<string>`count(*)` })
          .from(examParticipants)
          .where(inArray(examParticipants.sessionId, rows.map((r) => r.session.id)))
          .groupBy(examParticipants.sessionId)
      : []
    const byId = new Map(counts.map((c) => [c.sessionId, Number(c.n)]))
    return rows.map(({ session, title }) => ({
      id: session.id,
      examId: session.examId,
      examTitle: title,
      createdAt: session.createdAt.toISOString(),
      status: effectiveStatus(session),
      participants: byId.get(session.id) ?? 0,
    }))
  })

export const createSession = createServerFn({ method: 'POST' })
  .middleware([requireExamStaff])
  .validator(
    z.object({
      examId: z.number().int().positive(),
      durationMinutes: z.number().int().min(5).max(300),
      /** Typed logins (nowak, kowalski…) or, when empty, `auto` generated ones (BA1, CH7…). */
      logins: z.array(z.string().trim().min(1).max(40)).max(200),
      auto: z.number().int().min(0).max(200),
    }),
  )
  .handler(async ({ data, context }) => {
    const typed = [...new Set(data.logins.map((l) => l.trim()))].filter(Boolean)
    const logins = typed.length ? typed : autoLogins(data.auto)
    if (logins.length === 0) return { ok: false as const, error: 'Podaj loginy albo liczbę osób do wygenerowania.' }
    const [available] = await db
      .select({ n: sql<string>`count(*)` })
      .from(examQuestions)
      .where(eq(examQuestions.examId, data.examId))
    if (!Number(available?.n ?? 0)) return { ok: false as const, error: 'Ten egzamin nie ma pytań.' }
    const [session] = await db
      .insert(examSessions)
      .values({
        examId: data.examId,
        createdBy: context.identity,
        token: randomToken(),
        durationMinutes: data.durationMinutes,
      })
      .returning({ id: examSessions.id })
    await db.insert(examParticipants).values(logins.map((login) => ({ sessionId: session.id, login })))
    return { ok: true as const, id: session.id }
  })

export type SessionDetail = {
  id: number
  examId: number
  examTitle: string
  passPercent: number
  token: string
  durationMinutes: number
  status: 'lobby' | 'running' | 'finished'
  secondsLeft: number | null
  participants: {
    id: number
    login: string
    claimed: boolean
    version: string | null
    submitted: boolean
    idleSeconds: number | null
    seenSecondsAgo: number | null
    events: Record<string, number>
    summary: ReturnType<typeof summarize> | null
  }[]
}

async function sessionDetail(id: number): Promise<SessionDetail | null> {
  const [row] = await db
    .select({ session: examSessions, exam: exams })
    .from(examSessions)
    .innerJoin(exams, eq(exams.id, examSessions.examId))
    .where(eq(examSessions.id, id))
    .limit(1)
  if (!row) return null
  const { session, exam } = row
  const people = await db
    .select()
    .from(examParticipants)
    .where(eq(examParticipants.sessionId, id))
    .orderBy(asc(examParticipants.id))
  const eventRows = people.length
    ? await db
        .select({ participantId: examEvents.participantId, kind: examEvents.kind, n: sql<string>`count(*)` })
        .from(examEvents)
        .where(inArray(examEvents.participantId, people.map((p) => p.id)))
        .groupBy(examEvents.participantId, examEvents.kind)
    : []
  const questions = await db.select().from(examQuestions).where(eq(examQuestions.examId, exam.id))
  const now = Date.now()
  const status = effectiveStatus(session)
  return {
    id: session.id,
    examId: exam.id,
    examTitle: exam.title,
    passPercent: exam.passPercent,
    token: session.token,
    durationMinutes: session.durationMinutes,
    status,
    secondsLeft:
      status === 'running' && session.endsAt ? Math.max(0, Math.round((session.endsAt.getTime() - now) / 1000)) : null,
    participants: people.map((p) => {
      const events: Record<string, number> = {}
      for (const e of eventRows) if (e.participantId === p.id) events[e.kind] = Number(e.n)
      const own = questions.filter((q) => q.version === p.version) as StoredQuestion[]
      return {
        id: p.id,
        login: p.login,
        claimed: p.token !== null,
        version: p.version,
        submitted: p.submittedAt !== null,
        idleSeconds: p.lastActivityAt ? Math.round((now - p.lastActivityAt.getTime()) / 1000) : null,
        seenSecondsAgo: p.lastSeenAt ? Math.round((now - p.lastSeenAt.getTime()) / 1000) : null,
        events,
        summary:
          status === 'finished' && p.version
            ? summarize(own, parseJsonRecord(p.answers), parseJsonRecord(p.openGrades), exam.passPercent)
            : null,
      }
    }),
  }
}

/** Live view of a session; the console polls it every few seconds. */
export const getSession = createServerFn({ method: 'GET' })
  .middleware([requireExamStaff])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => sessionDetail(data.id))

/** Everyone who joined starts at the same moment; the clock runs from here. */
export const startSession = createServerFn({ method: 'POST' })
  .middleware([requireExamStaff])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const [session] = await db.select().from(examSessions).where(eq(examSessions.id, data.id)).limit(1)
    if (!session || session.status !== 'lobby') return { ok: false as const, error: 'Test już wystartował.' }
    const endsAt = new Date(Date.now() + session.durationMinutes * 60_000)
    await db
      .update(examSessions)
      .set({ status: 'running', startedAt: new Date(), endsAt })
      .where(eq(examSessions.id, data.id))
    return { ok: true as const }
  })

export const finishSession = createServerFn({ method: 'POST' })
  .middleware([requireExamStaff])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    await db
      .update(examSessions)
      .set({ status: 'finished', endsAt: new Date() })
      .where(eq(examSessions.id, data.id))
    return { ok: true as const }
  })

export const deleteSession = createServerFn({ method: 'POST' })
  .middleware([requireExamStaff])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }) => {
    const people = await db.select({ id: examParticipants.id }).from(examParticipants).where(eq(examParticipants.sessionId, data.id))
    if (people.length) await db.delete(examEvents).where(inArray(examEvents.participantId, people.map((p) => p.id)))
    await db.delete(examParticipants).where(eq(examParticipants.sessionId, data.id))
    await db.delete(examSessions).where(eq(examSessions.id, data.id))
    return { ok: true as const }
  })

export type ParticipantReview = {
  login: string
  version: string | null
  summary: ReturnType<typeof summarize>
  events: { at: string; kind: string; details: string | null }[]
  open: { id: number; prompt: string; model: string; answer: string; grade: string | null }[]
}

/** Answers to open questions and the activity log of one participant, for marking. */
export const reviewParticipant = createServerFn({ method: 'GET' })
  .middleware([requireExamStaff])
  .validator(z.object({ id: z.number().int().positive() }))
  .handler(async ({ data }): Promise<ParticipantReview | null> => {
    const [person] = await db.select().from(examParticipants).where(eq(examParticipants.id, data.id)).limit(1)
    if (!person) return null
    const [row] = await db
      .select({ examId: examSessions.examId, pass: exams.passPercent })
      .from(examSessions)
      .innerJoin(exams, eq(exams.id, examSessions.examId))
      .where(eq(examSessions.id, person.sessionId))
      .limit(1)
    const questions = person.version
      ? ((await db
          .select()
          .from(examQuestions)
          .where(and(eq(examQuestions.examId, row.examId), eq(examQuestions.version, person.version)))
          .orderBy(asc(examQuestions.position))) as StoredQuestion[])
      : []
    const answers = parseJsonRecord(person.answers)
    const grades = parseJsonRecord(person.openGrades)
    const events = await db
      .select()
      .from(examEvents)
      .where(eq(examEvents.participantId, person.id))
      .orderBy(asc(examEvents.id))
      .limit(300)
    return {
      login: person.login,
      version: person.version,
      summary: summarize(questions, answers, grades, row.pass),
      events: events.map((e) => ({ at: e.createdAt.toISOString(), kind: e.kind, details: e.details })),
      open: questions
        .filter((q) => q.kind === 'open')
        .map((q) => ({
          id: q.id,
          prompt: q.prompt,
          model: q.correct,
          answer: answers[String(q.id)] ?? '',
          grade: grades[String(q.id)] ?? null,
        })),
    }
  })

/** Examiner's pass/fail mark for one open answer (null clears it). */
export const gradeOpen = createServerFn({ method: 'POST' })
  .middleware([requireExamStaff])
  .validator(
    z.object({
      participantId: z.number().int().positive(),
      questionId: z.number().int().positive(),
      verdict: z.enum(['pass', 'fail']).nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const [person] = await db.select().from(examParticipants).where(eq(examParticipants.id, data.participantId)).limit(1)
    if (!person) return { ok: false as const }
    const grades = parseJsonRecord(person.openGrades)
    if (data.verdict) grades[String(data.questionId)] = data.verdict
    else delete grades[String(data.questionId)]
    await db
      .update(examParticipants)
      .set({ openGrades: JSON.stringify(grades) })
      .where(eq(examParticipants.id, data.participantId))
    return { ok: true as const }
  })
