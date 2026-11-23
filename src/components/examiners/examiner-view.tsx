import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Lightbulb, Paperclip, Send, Timer } from 'lucide-react'
import { toast } from 'sonner'

import { Panel } from '@/components/admin/panel'
import { compressImage } from '@/components/admin/request-form'
import { RequestStatusBadge } from '@/components/admin/requests-panels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EXAMINER_TIPS } from '@/lib/examiners'
import {
  examinerOverview,
  listMyExaminerRequests,
  submitExaminerRequest,
  type ExaminerOverview,
  type ExaminerRequestRow,
} from '@/lib/examiners.functions'
import {
  PESEL_MAX_LENGTH,
  PROFESSIONS,
  formatDateTime,
  isParamedic,
  isPesel,
  managementBadge,
  pwzFromPesel,
} from '@/lib/registry'

const selectClass =
  'h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

function formatWait(seconds: number) {
  const m = Math.floor(seconds / 60)
  return `${m}:${String(seconds % 60).padStart(2, '0')}`
}

type Draft = { firstName: string; lastName: string; pesel: string; profession: string; specialization: string }
const EMPTY_DRAFT: Draft = { firstName: '', lastName: '', pesel: '', profession: PROFESSIONS[0], specialization: '' }

function loadDraft(email: string): Draft {
  try {
    const raw = localStorage.getItem(`examiner-draft:${email}`)
    return raw ? { ...EMPTY_DRAFT, ...(JSON.parse(raw) as Partial<Draft>) } : EMPTY_DRAFT
  } catch {
    return EMPTY_DRAFT
  }
}

/** The examiner's panel: limit meter, counters, a request form with a saved draft and the request history. */
export function ExaminerView({ email }: { email: string }) {
  const [overview, setOverview] = useState<ExaminerOverview | null>(null)
  const [rows, setRows] = useState<ExaminerRequestRow[] | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [proof, setProof] = useState<string | null>(null)
  const [proofName, setProofName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const [o, r] = await Promise.all([examinerOverview(), listMyExaminerRequests()])
      setOverview(o)
      setRows(r)
      setSecondsLeft(o.secondsToNext)
    } catch {
      toast.error('Nie udało się wczytać panelu egzaminatora.')
      setRows((current) => current ?? [])
    }
  }, [])

  useEffect(() => {
    setDraft(loadDraft(email))
    void reload()
  }, [email, reload])

  useEffect(() => {
    if (secondsLeft <= 0) return
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(timer)
  }, [secondsLeft > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  // When the countdown ends, one more slot is free: refresh the meter.
  useEffect(() => {
    if (overview && overview.secondsToNext > 0 && secondsLeft === 0) void reload()
  }, [secondsLeft]) // eslint-disable-line react-hooks/exhaustive-deps

  function change(patch: Partial<Draft>) {
    const next = { ...draft, ...patch }
    setDraft(next)
    try {
      localStorage.setItem(`examiner-draft:${email}`, JSON.stringify(next))
    } catch {
      // the draft then lasts until reload
    }
  }

  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    if (!file.type.startsWith('image/')) {
      setError('Dołącz zrzut ekranu jako plik obrazu.')
      return
    }
    try {
      setProof(await compressImage(file))
      setProofName(file.name)
    } catch {
      setProof(null)
      setProofName('')
      setError('Nie udało się wczytać zrzutu ekranu. Spróbuj innego pliku.')
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (secondsLeft > 0) return
    if (!isPesel(draft.pesel)) {
      setError('PESEL musi składać się z samych cyfr (co najmniej jednej).')
      return
    }
    if (!proof) {
      setError('Dołącz zrzut ekranu wiadomości, w której osoba prosi o wpis.')
      return
    }
    setPending(true)
    setError(null)
    try {
      const paramedic = isParamedic(draft.profession)
      const result = await submitExaminerRequest({
        data: {
          person: {
            pesel: draft.pesel,
            firstName: draft.firstName,
            lastName: draft.lastName,
            profession: draft.profession as (typeof PROFESSIONS)[number],
            specialization: paramedic ? undefined : draft.specialization,
          },
          proof,
        },
      })
      if (!result.ok) {
        setError(result.error)
        if (result.secondsLeft) setSecondsLeft(result.secondsLeft)
        void reload()
        return
      }
      toast.success('Wniosek wysłany do administratora.')
      setDraft(EMPTY_DRAFT)
      try {
        localStorage.removeItem(`examiner-draft:${email}`)
      } catch {
        // nothing to clean up
      }
      setProof(null)
      setProofName('')
      await reload()
    } catch {
      setError('Nie udało się wysłać wniosku.')
    } finally {
      setPending(false)
    }
  }

  const paramedic = isParamedic(draft.profession)
  const blocked = secondsLeft > 0
  const limit = overview?.limits
  const used = overview ? Math.min(overview.usedInWindow, overview.limits.requestsCount) : 0
  const badge = overview ? managementBadge(overview.stats.approved) : null
  const tip = EXAMINER_TIPS[new Date().getDate() % EXAMINER_TIPS.length]
  const maxDay = Math.max(1, ...(overview?.days ?? [1]))

  return (
    <div className="space-y-6">
      {overview && (
        <div className="grid gap-4 md:grid-cols-3">
          <Panel>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Timer className="size-4" /> Limit wniosków
            </p>
            <p className="mt-2 text-3xl font-bold tabular-nums">
              {Math.max(0, limit!.requestsCount - used)}
              <span className="text-base font-normal text-muted-foreground"> z {limit!.requestsCount} wolnych</span>
            </p>
            <div className="mt-2 flex gap-1" aria-hidden>
              {Array.from({ length: limit!.requestsCount }, (_, i) => (
                <span key={i} className={`h-2 flex-1 rounded ${i < used ? 'bg-primary' : 'bg-muted'}`} />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {blocked
                ? `Kolejny wniosek za ${formatWait(secondsLeft)}`
                : `Okno: ${limit!.requestsWindowMinutes} min. Limit odnawia się sam.`}
            </p>
          </Panel>
          <Panel>
            <p className="text-sm font-semibold">Twoje wnioski</p>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div><dt className="text-xs text-muted-foreground">Przyjęte</dt><dd className="text-2xl font-bold text-emerald-700">{overview.stats.approved}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Oczekują</dt><dd className="text-2xl font-bold text-amber-700">{overview.stats.pending}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Odrzucone</dt><dd className="text-2xl font-bold text-rose-700">{overview.stats.rejected}</dd></div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              {badge ? `Odznaka: ${badge}` : 'Pierwsza odznaka po pierwszym przyjętym wniosku.'}
            </p>
          </Panel>
          <Panel>
            <p className="text-sm font-semibold">Aktywność, 14 dni</p>
            <div className="mt-3 flex h-16 items-end gap-1" role="img" aria-label="Liczba wniosków w ostatnich 14 dniach">
              {overview.days.map((n, i) => (
                <span
                  key={i}
                  title={`${n} wniosków`}
                  className="flex-1 rounded-t bg-primary/70"
                  style={{ height: `${Math.max(4, (n / maxDay) * 100)}%`, opacity: n ? 1 : 0.25 }}
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Razem wysłano: {overview.stats.total}</p>
          </Panel>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <Lightbulb className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p><strong>Wskazówka dnia:</strong> {tip}</p>
      </div>

      {overview && !overview.requestsOpen && (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Składanie wniosków jest chwilowo wyłączone przez właściciela strony.
        </p>
      )}

      <Panel>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Send className="size-5" /> Złóż wniosek o wpis
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Osobę do rejestru dodaje administrator po sprawdzeniu zrzutu ekranu wiadomości, w której ta osoba prosi o wpis.
          Szkic zapisuje się automatycznie w tej przeglądarce.
        </p>
        <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ex-firstName">Imię</Label>
            <Input id="ex-firstName" required maxLength={80} value={draft.firstName} onChange={(e) => change({ firstName: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ex-lastName">Nazwisko</Label>
            <Input id="ex-lastName" required maxLength={80} value={draft.lastName} onChange={(e) => change({ lastName: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ex-pesel">PESEL</Label>
            <Input
              id="ex-pesel"
              inputMode="numeric"
              required
              value={draft.pesel}
              onChange={(e) => change({ pesel: e.target.value.replace(/\D/g, '').slice(0, PESEL_MAX_LENGTH) })}
            />
            <p className="text-xs text-muted-foreground">
              Numer PWZ: <span className="font-mono text-foreground">{isPesel(draft.pesel) ? pwzFromPesel(draft.pesel) : '—'}</span> (wyliczany automatycznie)
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ex-profession">Zawód</Label>
            <select id="ex-profession" value={draft.profession} onChange={(e) => change({ profession: e.target.value })} className={selectClass}>
              {PROFESSIONS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="ex-specialization">Specjalizacja (opcjonalnie)</Label>
            {paramedic ? (
              <Input id="ex-specialization" value="nd." disabled />
            ) : (
              <Input id="ex-specialization" maxLength={160} placeholder="np. chirurgia ogólna" value={draft.specialization} onChange={(e) => change({ specialization: e.target.value })} />
            )}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="ex-proof">Zrzut ekranu wiadomości (dowód, że osoba chce wpis)</Label>
            <Input id="ex-proof" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void pickFile(e)} />
            {proof && (
              <div className="space-y-1">
                <p className="flex items-center gap-1 text-xs text-muted-foreground"><Paperclip className="size-3" /> {proofName}</p>
                <img src={proof} alt="Podgląd zrzutu ekranu" className="max-h-56 rounded border object-contain" />
              </div>
            )}
          </div>
          {error && <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending || blocked || (overview ? !overview.requestsOpen : false)}>
              {pending ? 'Wysyłanie…' : blocked ? `Kolejny wniosek za ${formatWait(secondsLeft)}` : 'Wyślij wniosek'}
            </Button>
            {limit && !blocked && (
              <p className="mt-2 text-xs text-muted-foreground">
                Limit: {limit.requestsCount} wnioski na {limit.requestsWindowMinutes} min, nie więcej niż {limit.pendingMax} czekających naraz.
              </p>
            )}
          </div>
        </form>
      </Panel>

      <Panel>
        <h2 className="text-lg font-semibold">Moje wnioski{rows ? ` (${rows.length})` : ''}</h2>
        {rows === null ? (
          <p className="mt-4 text-muted-foreground">Wczytywanie…</p>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-muted-foreground">Nie złożono jeszcze żadnego wniosku.</p>
        ) : (
          <ul className="mt-4 divide-y">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                <div>
                  <p className="font-medium">
                    {row.firstName} {row.lastName}{' '}
                    <span className="font-mono text-xs font-normal text-muted-foreground">PESEL {row.pesel}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.profession} · złożono {formatDateTime(row.createdAt)}
                    {row.decidedAt ? ` · decyzja ${formatDateTime(row.decidedAt)}` : ''}
                  </p>
                  {row.note && <p className="mt-1 text-sm">Uwaga administratora: {row.note}</p>}
                </div>
                <RequestStatusBadge status={row.status} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
