import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  examState,
  joinSession,
  reportExamEvent,
  saveAnswer,
  submitExam,
  type ExamState,
} from '@/lib/exam-student.functions'
import type { StudentQuestion } from '@/lib/exams-server'

export const Route = createFileRoute('/egzamin/$token')({
  head: () => ({ meta: [{ title: 'Egzamin – Centralny Rejestr' }, { name: 'robots', content: 'noindex' }] }),
  component: ExamPage,
})

type EventKind = 'blur' | 'focus' | 'idle' | 'back' | 'copy' | 'paste' | 'cut' | 'contextmenu' | 'resize' | 'offline'

const IDLE_SECONDS = 60
const LETTERS = ['A', 'B', 'C', 'D', 'E']

function storageKey(token: string) {
  return `exam-pt:${token}`
}

function ExamPage() {
  const { token } = Route.useParams()
  const [participantToken, setParticipantToken] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [state, setState] = useState<ExamState | null>(null)
  const [questions, setQuestions] = useState<StudentQuestion[] | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [secondsLeft, setSecondsLeft] = useState(0)

  useEffect(() => {
    try {
      setParticipantToken(localStorage.getItem(storageKey(token)))
    } catch {
      // without storage the student can only join once per page load
    }
    setReady(true)
  }, [token])

  const refresh = useCallback(async () => {
    if (!participantToken) return
    try {
      const result = await examState({ data: { token, participantToken, withQuestions: questions === null } })
      setState(result)
      if (result.state === 'running') {
        setSecondsLeft(result.secondsLeft)
        if (result.questions) {
          setQuestions(result.questions)
          setAnswers(result.answers)
        }
      }
    } catch {
      // a temporary network problem: try again at the next tick
    }
  }, [participantToken, token, questions])

  useEffect(() => {
    if (!participantToken) return
    void refresh()
    const interval = setInterval(() => void refresh(), state?.state === 'running' ? 10_000 : 3_000)
    return () => clearInterval(interval)
  }, [participantToken, refresh, state?.state])

  useEffect(() => {
    if (state?.state !== 'running') return
    const tick = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(tick)
  }, [state?.state])

  if (!ready) return null
  if (!participantToken) {
    return (
      <Shell>
        <JoinForm
          token={token}
          onJoined={(pt) => {
            try {
              localStorage.setItem(storageKey(token), pt)
            } catch {
              // ignore
            }
            setParticipantToken(pt)
          }}
        />
      </Shell>
    )
  }
  if (!state) return <Shell><p className="text-muted-foreground">Wczytywanie…</p></Shell>
  if (state.state === 'invalid') {
    return (
      <Shell>
        <p role="alert" className="text-destructive">
          Ten link jest nieprawidłowy albo wygasł. Poproś prowadzącego o nowy.
        </p>
      </Shell>
    )
  }
  if (state.state === 'lobby') {
    return (
      <Shell title={state.title}>
        <p className="text-lg font-semibold">Jesteś zalogowany jako {state.login}.</p>
        <p className="mt-2 text-muted-foreground">
          Czekaj na start testu. Zaczniecie wszyscy w tej samej chwili. Czas na rozwiązanie: {state.durationMinutes} min.
        </p>
        <Rules />
      </Shell>
    )
  }
  if (state.state === 'finished') {
    return (
      <Shell title={state.title}>
        <p className="text-lg font-semibold">{state.submitted ? 'Praca oddana.' : 'Czas minął.'}</p>
        <p className="mt-2 text-muted-foreground">
          Twoje odpowiedzi zostały zapisane. Wynik ogłosi prowadzący. Możesz zamknąć tę kartę.
        </p>
      </Shell>
    )
  }
  return (
    <ExamRunner
      token={token}
      participantToken={participantToken}
      login={state.login}
      title={state.title}
      questions={questions}
      answers={answers}
      setAnswers={setAnswers}
      secondsLeft={secondsLeft}
      onSubmitted={() => void refresh()}
    />
  )
}

function Shell({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-[var(--registry-navy)]">
        {title ?? 'Egzamin'}
      </h1>
      <div className="mt-6 rounded-lg border bg-white p-6 shadow-sm">{children}</div>
    </div>
  )
}

function Rules() {
  return (
    <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
      <li>Pytania i odpowiedzi masz w innej kolejności niż pozostałe osoby.</li>
      <li>
        Zapisujemy opuszczenie okna lub karty, długą bezczynność, kopiowanie i wklejanie oraz zmianę rozmiaru okna.
        Egzaminator to widzi.
      </li>
      <li>Odpowiedzi zapisują się od razu. Odświeżenie strony nie kasuje pracy.</li>
    </ul>
  )
}

function JoinForm({ token, onJoined }: { token: string; onJoined: (participantToken: string) => void }) {
  const [login, setLogin] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      const result = await joinSession({ data: { token, login } })
      if (result.ok) onJoined(result.participantToken)
      else setError(result.error)
    } catch {
      setError('Nie udało się dołączyć. Spróbuj ponownie.')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label htmlFor="exam-login" className="font-semibold">Wpisz swój login od prowadzącego</label>
      <Input id="exam-login" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" placeholder="np. nowak albo BA1" required />
      <p className="text-xs text-muted-foreground">Login działa tylko na jednym urządzeniu. Nie udostępniaj go nikomu.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>{pending ? 'Sprawdzam…' : 'Dołącz'}</Button>
    </form>
  )
}

function formatClock(total: number) {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function ExamRunner({
  token,
  participantToken,
  login,
  title,
  questions,
  answers,
  setAnswers,
  secondsLeft,
  onSubmitted,
}: {
  token: string
  participantToken: string
  login: string
  title: string
  questions: StudentQuestion[] | null
  answers: Record<string, string>
  setAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>
  secondsLeft: number
  onSubmitted: () => void
}) {
  const [saving, setSaving] = useState(0)
  const [warning, setWarning] = useState<string | null>(null)
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})

  // --- monitoring: everything suspicious is reported to the examiner ---------------------------
  const report = useCallback(
    (kind: EventKind, details?: string) => {
      void reportExamEvent({ data: { token, participantToken, kind, details } }).catch(() => undefined)
    },
    [token, participantToken],
  )

  useEffect(() => {
    let leftAt: number | null = null
    let lastInput = Date.now()
    let idleReported = false
    let lastResize = 0
    const baseWidth = window.innerWidth

    const leave = (why: string) => {
      if (leftAt !== null) return
      leftAt = Date.now()
      report('blur', why)
      setWarning('Opuszczenie okna lub karty jest zapisywane.')
    }
    const back = () => {
      if (leftAt === null) return
      const secs = Math.round((Date.now() - leftAt) / 1000)
      leftAt = null
      report('back', `po ${secs} s`)
    }
    const onVisibility = () => (document.hidden ? leave('karta ukryta') : back())
    const onBlur = () => leave('okno straciło fokus')
    const onFocus = () => back()
    const onInput = () => {
      lastInput = Date.now()
      if (idleReported) {
        idleReported = false
        report('back', 'po bezczynności')
      }
    }
    const block = (kind: 'copy' | 'cut' | 'paste' | 'contextmenu') => (e: Event) => {
      e.preventDefault()
      report(kind)
      setWarning('Kopiowanie, wklejanie i menu kontekstowe są zablokowane i zapisywane.')
    }
    const onCopy = block('copy')
    const onCut = block('cut')
    const onPaste = block('paste')
    const onMenu = block('contextmenu')
    const onResize = () => {
      const now = Date.now()
      if (now - lastResize < 20_000) return
      if (Math.abs(window.innerWidth - baseWidth) / baseWidth > 0.25) {
        lastResize = now
        report('resize', `szerokość ${baseWidth} → ${window.innerWidth}`)
      }
    }
    const onOffline = () => report('offline')
    const idleTimer = setInterval(() => {
      if (!idleReported && Date.now() - lastInput > IDLE_SECONDS * 1000) {
        idleReported = true
        report('idle', `bez ruchu myszy i klawiatury ponad ${IDLE_SECONDS} s`)
      }
    }, 5000)

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    for (const name of ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll']) {
      window.addEventListener(name, onInput, { passive: true })
    }
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    document.addEventListener('contextmenu', onMenu)
    window.addEventListener('resize', onResize)
    window.addEventListener('offline', onOffline)
    return () => {
      clearInterval(idleTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      for (const name of ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll']) {
        window.removeEventListener(name, onInput)
      }
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
      document.removeEventListener('contextmenu', onMenu)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('offline', onOffline)
    }
  }, [report])

  // --- answers: saved on the server straight away -----------------------------------------------
  function persist(questionId: number, answer: string, delay: number) {
    setAnswers((current) => ({ ...current, [String(questionId)]: answer }))
    clearTimeout(timers.current[questionId])
    timers.current[questionId] = setTimeout(async () => {
      setSaving((n) => n + 1)
      try {
        const result = await saveAnswer({ data: { token, participantToken, questionId, answer } })
        if (!result.ok) toast.error('Nie zapisano odpowiedzi (czas minął lub test się zakończył).')
      } catch {
        toast.error('Brak połączenia. Odpowiedź zapisze się po jego powrocie, gdy ją zmienisz ponownie.')
      } finally {
        setSaving((n) => n - 1)
      }
    }, delay)
  }

  async function submit() {
    if (!window.confirm('Oddać pracę? Nie będzie można już nic zmienić.')) return
    await Promise.all(
      Object.keys(timers.current).map(async (id) => {
        clearTimeout(timers.current[Number(id)])
        const answer = answers[id]
        if (answer !== undefined) {
          await saveAnswer({ data: { token, participantToken, questionId: Number(id), answer } }).catch(() => undefined)
        }
      }),
    )
    await submitExam({ data: { token, participantToken } }).catch(() => undefined)
    onSubmitted()
  }

  const watermark = useMemo(() => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="260" height="160"><text x="20" y="90" transform="rotate(-25 130 80)" font-family="sans-serif" font-size="22" fill="rgba(0,0,0,0.07)">${login.replace(/[<>&"]/g, '')}</text></svg>`
    return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`
  }, [login])

  if (!questions) return <Shell title={title}><p className="text-muted-foreground">Wczytywanie pytań…</p></Shell>

  return (
    <div className="mx-auto max-w-3xl px-5 py-8" style={{ backgroundImage: watermark }}>
      <div className="sticky top-0 z-20 -mx-2 mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white/95 px-4 py-2 shadow-sm backdrop-blur">
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">Login: {login}{saving > 0 ? ' · zapisuję…' : ' · zapisano'}</p>
        </div>
        <p className={`font-mono text-2xl font-bold ${secondsLeft <= 60 ? 'text-red-600' : ''}`} aria-live="off">
          {formatClock(secondsLeft)}
        </p>
      </div>
      {warning && (
        <p role="alert" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {warning}
        </p>
      )}
      <ol className="space-y-5">
        {questions.map((q, index) => (
          <li key={q.id} className="rounded-lg border bg-white p-4 shadow-sm">
            <p className="select-none font-medium">
              {index + 1}. {q.prompt}
            </p>
            {q.kind === 'abcde' && (
              <div className="mt-3 space-y-2" role="radiogroup" aria-label={`Pytanie ${index + 1}`}>
                {q.options.map((option, i) => (
                  <label key={option.id} className="flex cursor-pointer select-none items-start gap-2 rounded-md border p-2 text-sm hover:bg-muted/50">
                    <input
                      type="radio"
                      name={`q${q.id}`}
                      checked={answers[String(q.id)] === String(option.id)}
                      onChange={() => persist(q.id, String(option.id), 0)}
                      className="mt-1"
                    />
                    <span><strong>{LETTERS[i]}.</strong> {option.text}</span>
                  </label>
                ))}
              </div>
            )}
            {q.kind === 'tf' && (
              <div className="mt-3 flex gap-3" role="radiogroup" aria-label={`Pytanie ${index + 1}`}>
                {(['true', 'false'] as const).map((value) => (
                  <label key={value} className="flex cursor-pointer select-none items-center gap-2 rounded-md border px-4 py-2 text-sm hover:bg-muted/50">
                    <input type="radio" name={`q${q.id}`} checked={answers[String(q.id)] === value} onChange={() => persist(q.id, value, 0)} />
                    {value === 'true' ? 'Prawda' : 'Fałsz'}
                  </label>
                ))}
              </div>
            )}
            {q.kind === 'open' && (
              <textarea
                rows={5}
                maxLength={4000}
                value={answers[String(q.id)] ?? ''}
                onChange={(e) => persist(q.id, e.target.value, 800)}
                aria-label={`Odpowiedź na pytanie ${index + 1}`}
                className="mt-3 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                placeholder="Wpisz odpowiedź własnymi słowami"
              />
            )}
          </li>
        ))}
      </ol>
      <div className="mt-6 flex justify-end">
        <Button onClick={() => void submit()}>Oddaj pracę</Button>
      </div>
    </div>
  )
}
