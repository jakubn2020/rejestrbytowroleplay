import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Panel } from '@/components/admin/panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  createSession,
  deleteQuestion,
  getExam,
  saveQuestion,
  updateExam,
  type ExamDetail,
} from '@/lib/exams.functions'
import type { ExamView } from '@/routes/egzaminy'

type Question = ExamDetail['questions'][number]
type Version = 'A' | 'B' | 'C'

const KIND_LABELS = { abcde: 'Zamknięte A–E', tf: 'Prawda / Fałsz', open: 'Otwarte' } as const

export function ExamEditor({ id, onOpen }: { id: number; onOpen: (view: ExamView) => void }) {
  const [exam, setExam] = useState<ExamDetail | null | undefined>(undefined)
  const [version, setVersion] = useState<Version>('A')

  const load = useCallback(async () => {
    try {
      setExam(await getExam({ data: { id } }))
    } catch {
      setExam(null)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  if (exam === undefined) return <p className="text-muted-foreground">Wczytywanie…</p>
  if (exam === null) return <p className="text-destructive">Nie znaleziono egzaminu.</p>

  const questions = exam.questions.filter((q) => q.version === version)

  return (
    <div className="space-y-6">
      <StartTest exam={exam} onStarted={(sessionId) => onOpen({ name: 'session', id: sessionId })} />
      <Settings exam={exam} onSaved={load} />

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Pytania</h2>
          <div className="flex gap-1" role="tablist" aria-label="Wersja egzaminu">
            {(['A', 'B', 'C'] as const).map((v) => (
              <Button key={v} size="sm" variant={version === v ? 'default' : 'outline'} onClick={() => setVersion(v)}>
                Wersja {v} ({exam.questions.filter((q) => q.version === v).length})
              </Button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Podczas testu każdy uczeń dostaje swoją wersję w losowej kolejności pytań i odpowiedzi. Sprawdź klucz poprawnych odpowiedzi, bo AI może się mylić.
        </p>
        <div className="mt-4 space-y-4">
          {questions.map((q, index) => (
            <QuestionCard key={`${q.id}-${q.prompt}`} examId={exam.id} version={version} question={q} number={index + 1} onChanged={load} />
          ))}
          {questions.length === 0 && <p className="text-muted-foreground">Ta wersja nie ma pytań.</p>}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {(['abcde', 'tf', 'open'] as const).map((kind) => (
            <AddQuestion key={kind} kind={kind} examId={exam.id} version={version} onAdded={load} />
          ))}
        </div>
      </Panel>
    </div>
  )
}

function Settings({ exam, onSaved }: { exam: ExamDetail; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(exam.title)
  const [duration, setDuration] = useState(exam.durationMinutes)
  const [pass, setPass] = useState(exam.passPercent)
  async function save() {
    try {
      await updateExam({ data: { id: exam.id, title, durationMinutes: duration, passPercent: pass } })
      toast.success('Zapisano ustawienia egzaminu.')
      await onSaved()
    } catch {
      toast.error('Nie udało się zapisać (sprawdź wartości).')
    }
  }
  return (
    <Panel>
      <h2 className="text-lg font-semibold">Ustawienia egzaminu</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_8rem_8rem_auto] sm:items-end">
        <label className="text-sm">Tytuł<Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" /></label>
        <label className="text-sm">Czas (min)<Input type="number" min={5} max={300} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="mt-1" /></label>
        <label className="text-sm">Próg (%)<Input type="number" min={1} max={100} value={pass} onChange={(e) => setPass(Number(e.target.value))} className="mt-1" /></label>
        <Button variant="outline" onClick={() => void save()}>Zapisz</Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Zakres zdania: min. próg % z pytań zamkniętych i wszystkie pytania otwarte uznane przez egzaminatora.</p>
    </Panel>
  )
}

function StartTest({ exam, onStarted }: { exam: ExamDetail; onStarted: (sessionId: number) => void }) {
  const [duration, setDuration] = useState(exam.durationMinutes)
  const [mode, setMode] = useState<'manual' | 'auto'>('manual')
  const [logins, setLogins] = useState('')
  const [auto, setAuto] = useState(10)
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    try {
      const list = mode === 'manual' ? logins.split(/[\n,;]+/).map((l) => l.trim()).filter(Boolean) : []
      const result = await createSession({
        data: { examId: exam.id, durationMinutes: duration, logins: list, auto: mode === 'auto' ? auto : 0 },
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      onStarted(result.id)
    } catch {
      toast.error('Nie udało się utworzyć testu.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel>
      <h2 className="text-lg font-semibold">Rozpocznij test</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Powstanie jednorazowy link dla uczniów. Wpiszą w nim swój login, poczekają w poczekalni, a Ty startujesz test dla wszystkich naraz.
      </p>
      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant={mode === 'manual' ? 'default' : 'outline'} onClick={() => setMode('manual')}>Wpiszę loginy ręcznie</Button>
          <Button size="sm" variant={mode === 'auto' ? 'default' : 'outline'} onClick={() => setMode('auto')}>Wygeneruj loginy (BA1, CH7…)</Button>
        </div>
        {mode === 'manual' ? (
          <textarea value={logins} onChange={(e) => setLogins(e.target.value)} rows={3} className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm" placeholder="nowak, kowalski, nowicki (po przecinku lub w osobnych liniach)" aria-label="Loginy uczniów" />
        ) : (
          <label className="block text-sm">Ile osób<Input type="number" min={1} max={200} value={auto} onChange={(e) => setAuto(Number(e.target.value))} className="mt-1 w-32" /></label>
        )}
        <label className="block text-sm">Czas na test (min)<Input type="number" min={5} max={300} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="mt-1 w-32" /></label>
        <Button disabled={busy} onClick={() => void create()}>{busy ? 'Tworzę…' : 'Utwórz test i link'}</Button>
      </div>
    </Panel>
  )
}

function AddQuestion({ kind, examId, version, onAdded }: { kind: Question['kind']; examId: number; version: Version; onAdded: () => Promise<void> }) {
  async function add() {
    const result = await saveQuestion({
      data: {
        examId,
        version,
        question: {
          kind,
          prompt: 'Nowe pytanie (uzupełnij treść)',
          options: kind === 'abcde' ? ['Odpowiedź 1', 'Odpowiedź 2', 'Odpowiedź 3', 'Odpowiedź 4', 'Odpowiedź 5'] : [],
          correct: kind === 'abcde' ? '0' : kind === 'tf' ? 'true' : '',
          points: 1,
        },
      },
    })
    if (!result.ok) toast.error(result.error)
    await onAdded()
  }
  return <Button size="sm" variant="outline" onClick={() => void add()}>+ {KIND_LABELS[kind]}</Button>
}

function QuestionCard({ examId, version, question, number, onChanged }: { examId: number; version: Version; question: Question; number: number; onChanged: () => Promise<void> }) {
  const [prompt, setPrompt] = useState(question.prompt)
  const [options, setOptions] = useState<string[]>(question.options.length === 5 ? question.options : ['', '', '', '', ''])
  const [correct, setCorrect] = useState(question.correct)
  const [points, setPoints] = useState(question.points)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const result = await saveQuestion({
        data: { examId, id: question.id, version, question: { kind: question.kind, prompt, options: question.kind === 'abcde' ? options : [], correct, points } },
      })
      if (!result.ok) toast.error(result.error)
      else {
        toast.success('Pytanie zapisane.')
        await onChanged()
      }
    } catch {
      toast.error('Nie udało się zapisać (sprawdź, czy wszystkie pola są uzupełnione).')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm('Usunąć to pytanie?')) return
    await deleteQuestion({ data: { id: question.id, examId } })
    await onChanged()
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{number}. {KIND_LABELS[question.kind]}</span>
        <label className="flex items-center gap-1">punkty <Input type="number" min={1} max={20} value={points} onChange={(e) => setPoints(Number(e.target.value))} className="h-7 w-16" /></label>
      </div>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} aria-label="Treść pytania" className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm" />
      {question.kind === 'abcde' && (
        <div className="space-y-1">
          {options.map((option, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="radio" name={`correct-${question.id}`} checked={correct === String(i)} onChange={() => setCorrect(String(i))} aria-label={`Odpowiedź ${'ABCDE'[i]} jest poprawna`} />
              <span className="w-4 text-sm font-semibold">{'ABCDE'[i]}</span>
              <Input value={option} onChange={(e) => setOptions((o) => o.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Odpowiedź ${'ABCDE'[i]}`} />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Zaznaczona kropka = poprawna odpowiedź.</p>
        </div>
      )}
      {question.kind === 'tf' && (
        <select value={correct} onChange={(e) => setCorrect(e.target.value)} aria-label="Poprawna odpowiedź" className="h-9 rounded-md border border-input bg-white px-3 text-sm">
          <option value="true">Prawda</option>
          <option value="false">Fałsz</option>
        </select>
      )}
      {question.kind === 'open' && (
        <label className="block text-xs text-muted-foreground">
          Wzorzec odpowiedzi (widzi go tylko egzaminator)
          <textarea value={correct} onChange={(e) => setCorrect(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-foreground" />
        </label>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => void save()}>Zapisz pytanie</Button>
        <Button size="sm" variant="ghost" onClick={() => void remove()}>Usuń</Button>
      </div>
    </div>
  )
}
