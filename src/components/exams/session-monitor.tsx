import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Panel } from '@/components/admin/panel'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/registry'
import {
  deleteSession,
  finishSession,
  getSession,
  gradeOpen,
  reviewParticipant,
  startSession,
  type ParticipantReview,
  type SessionDetail,
} from '@/lib/exams.functions'
import type { ExamView } from '@/routes/egzaminy'

const EVENT_LABELS: Record<string, string> = {
  blur: 'opuścił okno',
  back: 'wrócił',
  focus: 'fokus',
  idle: 'bezczynność',
  copy: 'kopiowanie',
  paste: 'wklejanie',
  cut: 'wycinanie',
  contextmenu: 'menu prawym',
  resize: 'zmiana okna',
  offline: 'brak sieci',
}

const RESULT_LABELS = { pass: 'ZALICZONY', fail: 'NIEZALICZONY', pending: 'do oceny' } as const

function clock(total: number) {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** How suspicious the activity looks (shown as a coloured dot). */
function suspicion(events: Record<string, number>): 'ok' | 'warn' | 'bad' {
  const away = events.blur ?? 0
  const bad = (events.paste ?? 0) + (events.copy ?? 0) + (events.cut ?? 0)
  if (away >= 4 || bad >= 2) return 'bad'
  if (away >= 1 || (events.idle ?? 0) >= 1 || bad >= 1 || (events.resize ?? 0) >= 1) return 'warn'
  return 'ok'
}

const DOT = { ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-600' } as const

export function SessionMonitor({ id, onOpen }: { id: number; onOpen: (view: ExamView) => void }) {
  const [session, setSession] = useState<SessionDetail | null | undefined>(undefined)
  const [reviewId, setReviewId] = useState<number | null>(null)
  const [, setTick] = useState(0)

  const load = useCallback(async () => {
    try {
      setSession(await getSession({ data: { id } }))
    } catch {
      // keep the last view; the next poll will try again
    }
  }, [id])

  useEffect(() => {
    void load()
    const poll = setInterval(() => void load(), 4000)
    const clockTick = setInterval(() => setTick((n) => n + 1), 1000)
    return () => {
      clearInterval(poll)
      clearInterval(clockTick)
    }
  }, [load])

  if (session === undefined) return <p className="text-muted-foreground">Wczytywanie…</p>
  if (session === null) return <p className="text-destructive">Nie znaleziono testu.</p>

  const link = `${window.location.origin}/egzamin/${session.token}`
  const joined = session.participants.filter((p) => p.claimed).length

  async function start() {
    if (!window.confirm(`Wystartować test dla ${joined} dołączonych osób? Zaczną wszyscy naraz, a czas to ${session?.durationMinutes} min.`)) return
    const result = await startSession({ data: { id } })
    if (!result.ok) toast.error(result.error)
    await load()
  }

  async function finish() {
    if (!window.confirm('Zakończyć test teraz dla wszystkich?')) return
    await finishSession({ data: { id } })
    await load()
  }

  async function remove() {
    if (!window.confirm('Usunąć ten test razem z wynikami?')) return
    await deleteSession({ data: { id } })
    onOpen({ name: 'home' })
  }

  return (
    <div className="space-y-6">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{session.examTitle}</h2>
            <p className="text-sm text-muted-foreground">
              {session.status === 'lobby' && `Poczekalnia: dołączyło ${joined} z ${session.participants.length}. Czas na test: ${session.durationMinutes} min.`}
              {session.status === 'running' && `Test trwa. Zostało ${clock(session.secondsLeft ?? 0)}.`}
              {session.status === 'finished' && 'Test zakończony. Oceń pytania otwarte poniżej.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {session.status === 'lobby' && <Button onClick={() => void start()} disabled={joined === 0}>Start dla wszystkich</Button>}
            {session.status === 'running' && <Button variant="destructive" onClick={() => void finish()}>Zakończ test teraz</Button>}
            <Button variant="ghost" onClick={() => void remove()}>Usuń test</Button>
          </div>
        </div>
        {session.status === 'lobby' && (
          <div className="mt-4 rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">Jednorazowy link dla uczniów:</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded border bg-white px-2 py-1 font-mono text-xs" aria-label="Link do testu" />
              <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(link); toast.success('Skopiowano link.') }}>Kopiuj</Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Każdy login działa tylko na jednym urządzeniu. Po starcie nowe osoby nie dołączą.</p>
          </div>
        )}
      </Panel>

      <Panel>
        <h2 className="text-lg font-semibold">Uczestnicy</h2>
        <div className="mt-3 overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Login</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Wer.</th>
                <th className="px-3 py-2">Aktywność</th>
                <th className="px-3 py-2">Zdarzenia</th>
                <th className="px-3 py-2">Wynik</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {session.participants.map((p) => {
                const level = suspicion(p.events)
                const idle = p.idleSeconds ?? 0
                return (
                  <tr key={p.id}>
                    <td className="px-3 py-2 font-mono font-semibold">{p.login}</td>
                    <td className="px-3 py-2">
                      {!p.claimed ? 'nie dołączył' : p.submitted ? 'oddał' : session.status === 'lobby' ? 'w poczekalni' : session.status === 'finished' ? 'czas minął' : 'pisze'}
                    </td>
                    <td className="px-3 py-2">{p.version ?? '–'}</td>
                    <td className="px-3 py-2 text-xs">
                      {session.status === 'running' && p.claimed && !p.submitted
                        ? idle > 60 ? <span className="font-semibold text-amber-700">brak ruchu {idle} s</span> : 'aktywny'
                        : '–'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className={`mr-2 inline-block size-2.5 rounded-full align-middle ${DOT[level]}`} aria-label={`Podejrzenie: ${level}`} />
                      {Object.entries(p.events).filter(([k]) => k !== 'back' && k !== 'focus').map(([k, n]) => `${EVENT_LABELS[k] ?? k}: ${n}`).join(' · ') || 'brak'}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {p.summary ? `${p.summary.percent}% (${p.summary.autoPoints}/${p.summary.autoMax}) · ${RESULT_LABELS[p.summary.result]}` : '–'}
                    </td>
                    <td className="px-3 py-2">
                      {p.claimed && <Button size="sm" variant="outline" onClick={() => setReviewId(p.id)}>Szczegóły</Button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {reviewId !== null && <Review key={reviewId} id={reviewId} finished={session.status === 'finished'} onClose={() => setReviewId(null)} onGraded={load} />}
    </div>
  )
}

function Review({ id, finished, onClose, onGraded }: { id: number; finished: boolean; onClose: () => void; onGraded: () => Promise<void> }) {
  const [review, setReview] = useState<ParticipantReview | null | undefined>(undefined)

  const load = useCallback(async () => {
    try {
      setReview(await reviewParticipant({ data: { id } }))
    } catch {
      setReview(null)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function grade(questionId: number, verdict: 'pass' | 'fail' | null) {
    await gradeOpen({ data: { participantId: id, questionId, verdict } })
    await load()
    await onGraded()
  }

  if (review === undefined) return <Panel><p className="text-muted-foreground">Wczytywanie…</p></Panel>
  if (review === null) return <Panel><p className="text-destructive">Nie udało się wczytać.</p></Panel>

  return (
    <Panel>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{review.login} (wersja {review.version ?? '–'})</h2>
        <Button size="sm" variant="ghost" onClick={onClose}>Zamknij</Button>
      </div>
      <p className="mt-1 text-sm">
        Pytania zamknięte: {review.summary.percent}% ({review.summary.autoPoints}/{review.summary.autoMax}). Otwarte ocenione: {review.summary.openGraded}/{review.summary.openTotal}. Wynik: <strong>{RESULT_LABELS[review.summary.result]}</strong>
      </p>

      {review.open.length > 0 && (
        <div className="mt-4 space-y-3">
          <h3 className="text-sm font-semibold">Pytania otwarte{finished ? '' : ' (oceniasz po zakończeniu testu)'}</h3>
          {review.open.map((q) => (
            <div key={q.id} className="rounded-md border p-3 text-sm">
              <p className="font-medium">{q.prompt}</p>
              <p className="mt-2 whitespace-pre-wrap rounded bg-muted/40 p-2">{q.answer || <em className="text-muted-foreground">brak odpowiedzi</em>}</p>
              <p className="mt-2 text-xs text-muted-foreground">Wzorzec: {q.model || '–'}</p>
              {finished && (
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant={q.grade === 'pass' ? 'default' : 'outline'} onClick={() => void grade(q.id, q.grade === 'pass' ? null : 'pass')}>Zaliczone</Button>
                  <Button size="sm" variant={q.grade === 'fail' ? 'destructive' : 'outline'} onClick={() => void grade(q.id, q.grade === 'fail' ? null : 'fail')}>Niezaliczone</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-4">
        <h3 className="text-sm font-semibold">Dziennik aktywności</h3>
        {review.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Brak zdarzeń.</p>
        ) : (
          <ul className="mt-1 max-h-60 divide-y overflow-y-auto rounded-md border text-xs">
            {review.events.map((e, i) => (
              <li key={i} className="px-2 py-1">
                <span className="text-muted-foreground">{formatDateTime(e.at)}</span> · {EVENT_LABELS[e.kind] ?? e.kind}
                {e.details ? ` (${e.details})` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}
