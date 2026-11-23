import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Panel } from '@/components/admin/panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDateTime } from '@/lib/registry'
import {
  createExam,
  deleteExam,
  generatePart,
  listExams,
  listSessions,
  type ExamListRow,
  type SessionListRow,
} from '@/lib/exams.functions'
import { extractPdfTextInBrowser } from '@/lib/pdf-text-client'
import type { ExamView } from '@/routes/egzaminy'

const MAX_PDF_BYTES = 6 * 1024 * 1024

const STATUS_LABELS = { lobby: 'czeka na start', running: 'trwa', finished: 'zakończony' } as const

export function ExamsHome({ onOpen }: { onOpen: (view: ExamView) => void }) {
  const [exams, setExams] = useState<ExamListRow[] | null>(null)
  const [sessions, setSessions] = useState<SessionListRow[] | null>(null)

  const load = useCallback(async () => {
    try {
      const [e, s] = await Promise.all([listExams(), listSessions()])
      setExams(e)
      setSessions(s)
    } catch {
      toast.error('Nie udało się wczytać egzaminów.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function remove(exam: ExamListRow) {
    if (!window.confirm(`Usunąć egzamin „${exam.title}” razem ze wszystkimi testami i wynikami?`)) return
    await deleteExam({ data: { id: exam.id } })
    await load()
  }

  return (
    <div className="space-y-6">
      <CreateForm onCreated={(id) => onOpen({ name: 'exam', id })} />

      <Panel>
        <h2 className="text-lg font-semibold">Twoje egzaminy</h2>
        {exams === null ? (
          <p className="mt-3 text-muted-foreground">Wczytywanie…</p>
        ) : exams.length === 0 ? (
          <p className="mt-3 text-muted-foreground">Brak egzaminów. Utwórz pierwszy powyżej.</p>
        ) : (
          <ul className="mt-3 divide-y rounded-md border">
            {exams.map((exam) => (
              <li key={exam.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div>
                  <p className="font-semibold">{exam.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {exam.questionCount} pytań w wersji · {exam.durationMinutes} min · {formatDateTime(exam.createdAt)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => onOpen({ name: 'exam', id: exam.id })}>Edytuj i uruchom test</Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(exam)}>Usuń</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <h2 className="text-lg font-semibold">Testy (ostatnie)</h2>
        {sessions === null ? (
          <p className="mt-3 text-muted-foreground">Wczytywanie…</p>
        ) : sessions.length === 0 ? (
          <p className="mt-3 text-muted-foreground">Nie przeprowadzono jeszcze żadnego testu.</p>
        ) : (
          <ul className="mt-3 divide-y rounded-md border">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div>
                  <p className="font-semibold">{s.examTitle}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(s.createdAt)} · {s.participants} osób · {STATUS_LABELS[s.status]}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => onOpen({ name: 'session', id: s.id })}>Otwórz</Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

function CreateForm({ onCreated }: { onCreated: (id: number) => void }) {
  const [title, setTitle] = useState('')
  const [topic, setTopic] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [nAbcde, setNAbcde] = useState(5)
  const [nTf, setNTf] = useState(3)
  const [nOpen, setNOpen] = useState(2)
  const [duration, setDuration] = useState(30)
  const [pass, setPass] = useState(60)
  const [versionCount, setVersionCount] = useState(3)
  const [provider, setProvider] = useState<'auto' | 'groq' | 'gemini'>('auto')
  const [busy, setBusy] = useState(false)

  const [progress, setProgress] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (file && file.size > MAX_PDF_BYTES) {
      toast.error('Plik PDF jest za duży (maksymalnie 6 MB).')
      return
    }
    if (nAbcde + nTf + nOpen === 0) {
      toast.error('Wybierz przynajmniej jedno pytanie.')
      return
    }
    setBusy(true)
    let examId: number | null = null
    try {
      let pdfText: string | undefined
      if (file) {
        try {
          pdfText = await extractPdfTextInBrowser(file)
        } catch {
          toast.error('Nie udało się odczytać PDF. Wklej treść zagadnień w pole tekstowe.')
          return
        }
        if (pdfText.length < 50 && !topic.trim()) {
          toast.error('W tym PDF nie ma tekstu (to chyba skan). Wklej treść zagadnień w pole tekstowe.')
          return
        }
      }
      const created = await createExam({
        data: { title, topic, pdfText, durationMinutes: duration, passPercent: pass },
      })
      if (!created.ok) {
        toast.error(created.error)
        return
      }
      examId = created.id

      // The PDF was uploaded once above. The requests go ONE AT A TIME (a free key allows only a few
      // requests per minute) and a rate-limit answer is waited out before trying again.
      const perVersion = nAbcde + nTf + nOpen
      const steps =
        perVersion <= 12
          ? [{ nAbcde, nTf, nOpen }]
          : ([
              nAbcde > 0 && { nAbcde, nTf: 0, nOpen: 0 },
              nTf + nOpen > 0 && { nAbcde: 0, nTf, nOpen },
            ].filter(Boolean) as { nAbcde: number; nTf: number; nOpen: number }[])
      const letters = (['A', 'B', 'C', 'D', 'E'] as const).slice(0, versionCount)
      const totalQuestions = perVersion * letters.length
      let added = 0
      const errors: string[] = []
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
      setProgress(`Generuję pytania… 0 z ${totalQuestions}`)
      const id = created.id

      for (const version of letters) {
        for (const step of steps) {
          let result: Awaited<ReturnType<typeof generatePart>> | null = null
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              result = await generatePart({ data: { examId: id, version, topic, provider, ...step } })
            } catch {
              result = { ok: false, error: 'Błąd połączenia z serwerem.' }
            }
            if (result.ok) break
            // Rate limit or overload: wait (the limit is per minute) and try again.
            if (attempt < 3 && /429|przeciążona|Limit zapytań/.test(result.error)) {
              for (let left = 25; left > 0; left--) {
                setProgress(`Limit zapytań AI, czekam ${left} s… (${added} z ${totalQuestions})`)
                await sleep(1000)
              }
            } else if (attempt < 3) {
              await sleep(1500)
            } else break
          }
          if (result?.ok) {
            added += result.added
            setProgress(`Generuję pytania… ${added} z ${totalQuestions}`)
          } else if (result) {
            errors.push(`wersja ${version}: ${result.error}`)
          }
        }
      }

      if (added === 0) {
        await deleteExam({ data: { id } }).catch(() => undefined)
        examId = null
        toast.error(errors[0] ?? 'Nie udało się wygenerować pytań.')
        return
      }
      if (errors.length) {
        toast.warning(`Część pytań nie powstała (${errors[0]}). Uzupełnij je ręcznie w edytorze.`)
      } else {
        toast.success('Egzamin wygenerowany. Sprawdź pytania przed użyciem.')
      }
      onCreated(id)
    } catch {
      if (examId !== null) await deleteExam({ data: { id: examId } }).catch(() => undefined)
      toast.error('Nie udało się utworzyć egzaminu (sprawdź połączenie i rozmiar pliku).')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const number = (value: number, set: (n: number) => void, label: string, min: number, max: number) => (
    <label className="text-sm">
      {label}
      <Input type="number" min={min} max={max} value={value} onChange={(e) => set(Number(e.target.value))} className="mt-1" />
    </label>
  )

  return (
    <Panel>
      <h2 className="text-lg font-semibold">Nowy egzamin (generowany przez AI)</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Opisz, z czego ma być egzamin, i/lub dołącz PDF z zagadnieniami. AI przygotuje wybraną liczbę wersji (A, B, C…), które potem możesz ręcznie poprawić. Każda wersja ma tyle pytań, ile ustawisz poniżej.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <label className="block text-sm">
          Tytuł
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} className="mt-1" placeholder="np. Egzamin z pierwszej pomocy, moduł 1" />
        </label>
        <label className="block text-sm">
          Z czego ma być egzamin (własnymi słowami)
          <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={4} maxLength={4000} className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm" placeholder="np. resuscytacja krążeniowo-oddechowa dorosłych, zasady AED, pozycja boczna ustalona…" />
        </label>
        <label className="block text-sm">
          Plik PDF z zagadnieniami (opcjonalnie, do 6 MB)
          <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="mt-1 block text-sm" />
        </label>
        <div className="grid gap-3 sm:grid-cols-6">
          {number(versionCount, setVersionCount, 'Liczba wersji (1–5)', 1, 5)}
          {number(nAbcde, setNAbcde, 'Pytań A–E', 0, 30)}
          {number(nTf, setNTf, 'Pytań P/F', 0, 30)}
          {number(nOpen, setNOpen, 'Pytań otwartych', 0, 15)}
          {number(duration, setDuration, 'Czas (min)', 5, 300)}
          {number(pass, setPass, 'Próg zdania (%)', 1, 100)}
        </div>
        <label className="block text-sm sm:max-w-xs">
          Które AI ma generować pytania
          <select value={provider} onChange={(e) => setProvider(e.target.value as 'auto' | 'groq' | 'gemini')} className="mt-1 h-9 w-full rounded-md border border-input bg-white px-2 text-sm">
            <option value="auto">Automatycznie (Groq, w razie błędu Gemini)</option>
            <option value="groq">Tylko Groq</option>
            <option value="gemini">Tylko Gemini</option>
          </select>
        </label>
        <Button type="submit" disabled={busy}>{busy ? (progress ?? 'Tworzę…') : 'Wygeneruj egzamin'}</Button>
      </form>
    </Panel>
  )
}
