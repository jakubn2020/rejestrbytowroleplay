import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { FLAG_KEYS, readFlag } from './site-settings-server'

import { db } from '../../db'
import { examEvents, examParticipants, examQuestions, examSessions, exams } from '../../db/schema'
import {
  VERSIONS,
  parseJsonRecord,
  randomSeed,
  randomToken,
  studentView,
  type StoredQuestion,
  type StudentQuestion,
} from './exams-server'

/** The grace period after the clock runs out in which the last answers are still accepted. */
const GRACE_MS = 5_000

const sessionToken = z.string().trim().min(10).max(40)
const personToken = z.string().trim().min(10).max(40)

async function sessionByToken(token: string) {
  const [row] = await db
    .select({ session: examSessions, exam: exams })
    .from(examSessions)
    .innerJoin(exams, eq(exams.id, examSessions.examId))
    .where(eq(examSessions.token, token))
    .limit(1)
  return row ?? null
}

function phase(session: { status: string; endsAt: Date | null }): 'lobby' | 'running' | 'finished' {
  if (session.status === 'running' && session.endsAt && session.endsAt.getTime() < Date.now()) return 'finished'
  return session.status as 'lobby' | 'running' | 'finished'
}

export type JoinResult =
  | { ok: true; participantToken: string; login: string }
  | { ok: false; error: string }

/** A student enters the login given by the lecturer; each login can be taken by one browser only. */
export const joinSession = createServerFn({ method: 'POST' })
  .validator(z.object({ token: sessionToken, login: z.string().trim().min(1).max(40) }))
  .handler(async ({ data }): Promise<JoinResult> => {
    if (!(await readFlag(FLAG_KEYS.exams))) return { ok: false, error: 'Egzaminy są chwilowo wyłączone przez właściciela strony.' }
    const found = await sessionByToken(data.token)
    if (!found) return { ok: false, error: 'Ten link jest nieprawidłowy lub wygasł.' }
    if (phase(found.session) === 'finished') return { ok: false, error: 'Ten test już się zakończył.' }
    if (found.session.status === 'running') {
      return { ok: false, error: 'Test już trwa. Dołączyć można tylko przed startem.' }
    }
    const [person] = await db
      .select()
      .from(examParticipants)
      .where(
        and(
          eq(examParticipants.sessionId, found.session.id),
          sql`lower(${examParticipants.login}) = ${data.login.toLowerCase()}`,
        ),
      )
      .limit(1)
    if (!person) return { ok: false, error: 'Nie ma takiego loginu. Sprawdź pisownię albo zapytaj prowadzącego.' }
    if (person.token) return { ok: false, error: 'Ten login został już użyty na innym urządzeniu.' }

    const [joined] = await db
      .select({ n: sql<string>`count(*)` })
      .from(examParticipants)
      .where(and(eq(examParticipants.sessionId, found.session.id), sql`${examParticipants.token} is not null`))
    const available = await db
      .selectDistinct({ version: examQuestions.version })
      .from(examQuestions)
      .where(eq(examQuestions.examId, found.exam.id))
    const versions = VERSIONS.filter((v) => available.some((a) => a.version === v))
    const version = versions[Number(joined?.n ?? 0) % Math.max(1, versions.length)] ?? 'A'

    const participantToken = randomToken()
    // The `token is null` condition makes the claim atomic: two browsers cannot take one login.
    const claimed = await db
      .update(examParticipants)
      .set({
        token: participantToken,
        version,
        seed: randomSeed(),
        joinedAt: new Date(),
        lastSeenAt: new Date(),
        lastActivityAt: new Date(),
      })
      .where(and(eq(examParticipants.id, person.id), sql`${examParticipants.token} is null`))
      .returning({ id: examParticipants.id })
    if (claimed.length === 0) return { ok: false, error: 'Ten login został już użyty na innym urządzeniu.' }
    return { ok: true, participantToken, login: person.login }
  })

export type ExamState =
  | { state: 'invalid' }
  | { state: 'lobby'; login: string; title: string; durationMinutes: number }
  | { state: 'finished'; login: string; title: string; submitted: boolean }
  | {
      state: 'running'
      login: string
      title: string
      secondsLeft: number
      questions: StudentQuestion[] | null
      answers: Record<string, string>
    }

/** Poll: what the student's screen should show now (also counts as a sign of life). */
export const examState = createServerFn({ method: 'POST' })
  .validator(z.object({ token: sessionToken, participantToken: personToken, withQuestions: z.boolean() }))
  .handler(async ({ data }): Promise<ExamState> => {
    const found = await sessionByToken(data.token)
    if (!found) return { state: 'invalid' }
    const [person] = await db
      .select()
      .from(examParticipants)
      .where(and(eq(examParticipants.sessionId, found.session.id), eq(examParticipants.token, data.participantToken)))
      .limit(1)
    if (!person) return { state: 'invalid' }
    await db.update(examParticipants).set({ lastSeenAt: new Date() }).where(eq(examParticipants.id, person.id))

    const current = phase(found.session)
    if (current === 'lobby') {
      return { state: 'lobby', login: person.login, title: found.exam.title, durationMinutes: found.session.durationMinutes }
    }
    if (current === 'finished' || person.submittedAt) {
      return { state: 'finished', login: person.login, title: found.exam.title, submitted: person.submittedAt !== null }
    }
    let questions: StudentQuestion[] | null = null
    if (data.withQuestions) {
      const rows = await db
        .select()
        .from(examQuestions)
        .where(and(eq(examQuestions.examId, found.exam.id), eq(examQuestions.version, person.version ?? 'A')))
        .orderBy(asc(examQuestions.position))
      questions = studentView(rows as StoredQuestion[], person.seed)
    }
    return {
      state: 'running',
      login: person.login,
      title: found.exam.title,
      secondsLeft: Math.max(0, Math.round(((found.session.endsAt?.getTime() ?? 0) - Date.now()) / 1000)),
      questions,
      answers: parseJsonRecord(person.answers),
    }
  })

async function activePerson(token: string, participantToken: string) {
  const found = await sessionByToken(token)
  if (!found || found.session.status !== 'running' || !found.session.endsAt) return null
  if (found.session.endsAt.getTime() + GRACE_MS < Date.now()) return null
  const [person] = await db
    .select()
    .from(examParticipants)
    .where(and(eq(examParticipants.sessionId, found.session.id), eq(examParticipants.token, participantToken)))
    .limit(1)
  if (!person || person.submittedAt) return null
  return { found, person }
}

/** Saves one answer right away (the answers are never kept only in the browser). */
export const saveAnswer = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      token: sessionToken,
      participantToken: personToken,
      questionId: z.number().int().positive(),
      answer: z.string().max(4000),
    }),
  )
  .handler(async ({ data }) => {
    const active = await activePerson(data.token, data.participantToken)
    if (!active) return { ok: false as const }
    const [question] = await db
      .select({ id: examQuestions.id, kind: examQuestions.kind })
      .from(examQuestions)
      .where(
        and(
          eq(examQuestions.id, data.questionId),
          eq(examQuestions.examId, active.found.exam.id),
          eq(examQuestions.version, active.person.version ?? 'A'),
        ),
      )
      .limit(1)
    if (!question) return { ok: false as const }
    if (question.kind === 'abcde' && !/^[0-4]$/.test(data.answer)) return { ok: false as const }
    if (question.kind === 'tf' && data.answer !== 'true' && data.answer !== 'false') return { ok: false as const }
    const patch = JSON.stringify({ [String(data.questionId)]: data.answer })
    await db
      .update(examParticipants)
      .set({
        answers: sql`(${examParticipants.answers}::jsonb || ${patch}::jsonb)::text`,
        lastSeenAt: new Date(),
        lastActivityAt: new Date(),
      })
      .where(eq(examParticipants.id, active.person.id))
    return { ok: true as const }
  })

const EVENT_KINDS = ['blur', 'focus', 'idle', 'back', 'copy', 'paste', 'cut', 'contextmenu', 'resize', 'offline'] as const
const MAX_EVENTS = 300

/** Suspicious behaviour reported by the exam page (leaving the window, long idle, copy/paste…). */
export const reportExamEvent = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      token: sessionToken,
      participantToken: personToken,
      kind: z.enum(EVENT_KINDS),
      details: z.string().max(200).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const active = await activePerson(data.token, data.participantToken)
    if (!active) return { ok: false as const }
    const [count] = await db
      .select({ n: sql<string>`count(*)` })
      .from(examEvents)
      .where(eq(examEvents.participantId, active.person.id))
    if (Number(count?.n ?? 0) >= MAX_EVENTS) return { ok: true as const }
    await db.insert(examEvents).values({
      participantId: active.person.id,
      kind: data.kind,
      details: data.details ?? null,
    })
    return { ok: true as const }
  })

/** The student hands in early. */
export const submitExam = createServerFn({ method: 'POST' })
  .validator(z.object({ token: sessionToken, participantToken: personToken }))
  .handler(async ({ data }) => {
    const active = await activePerson(data.token, data.participantToken)
    if (!active) return { ok: false as const }
    await db
      .update(examParticipants)
      .set({ submittedAt: new Date() })
      .where(eq(examParticipants.id, active.person.id))
    return { ok: true as const }
  })
