import { useState, type FormEvent } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { FileText, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDate, type EntryStatus } from '@/lib/registry'
import { searchRegistry, type SearchResult } from '@/lib/registry.functions'

export const Route = createFileRoute('/')({
  component: Home,
})

type State =
  | { phase: 'idle' }
  | { phase: 'pending' }
  | { phase: 'done'; query: string; result: SearchResult }
  | { phase: 'error' }

function Home() {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<State>({ phase: 'idle' })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const q = query.trim()
    if (!q || state.phase === 'pending') return
    setState({ phase: 'pending' })
    try {
      const result = await searchRegistry({ data: { q } })
      setState({ phase: 'done', query: q, result })
    } catch {
      setState({ phase: 'error' })
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-[var(--registry-navy)] sm:text-4xl">
        Wyszukiwarka rejestru
      </h1>
      <p className="mt-3 text-muted-foreground">
        Sprawdź prawo wykonywania zawodu lekarza, pielęgniarza lub ratownika
        medycznego. Wpisz numer PESEL, numer PWZ albo pełne imię i nazwisko.
      </p>

      <form
        onSubmit={submit}
        className="mt-8 rounded-lg border bg-white p-5 shadow-sm sm:p-6"
      >
        <Label htmlFor="q" className="text-sm font-semibold">
          PESEL, numer PWZ lub imię i nazwisko
        </Label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <Input
            id="q"
            name="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="np. 1234567 lub Jan Kowalski"
            autoComplete="off"
            className="h-11 bg-white text-base"
            required
          />
          <Button
            type="submit"
            className="h-11 px-6"
            disabled={state.phase === 'pending'}
          >
            <Search className="size-4" />
            {state.phase === 'pending' ? 'Szukam…' : 'Szukaj'}
          </Button>
        </div>
      </form>

      <section aria-live="polite" className="mt-8">
        {state.phase === 'error' && (
          <Notice>
            Wyszukiwanie nie powiodło się. Spróbuj ponownie za chwilę.
          </Notice>
        )}
        {state.phase === 'done' && state.result.status === 'invalid' && (
          <Notice>{state.result.message}</Notice>
        )}
        {state.phase === 'done' &&
          state.result.status === 'ok' &&
          (state.result.entries.length === 0 ? (
            <Notice>
              Nie znaleziono w rejestrze osoby pasującej do zapytania „
              {state.query}”.
            </Notice>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Liczba wyników: {state.result.entries.length}
              </p>
              {state.result.entries.map((entry) => (
                <article
                  key={entry.pwz}
                  className="overflow-hidden rounded-lg border bg-white shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3 border-b bg-[var(--registry-navy)]/5 px-5 py-3">
                    <h2 className="font-[family-name:var(--font-heading)] text-xl font-semibold">
                      {entry.firstName} {entry.lastName}
                    </h2>
                    <StatusBadge status={entry.status} />
                  </div>
                  <dl className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-3">
                    <Field label="Numer PWZ" value={entry.pwz} mono />
                    <Field label="Zawód" value={entry.profession} />
                    <Field label="Specjalizacja" value={entry.specialization} />
                    <Field label="Numer wpisu" value={entry.entryNumber} mono />
                    <Field label="Data wpisu" value={formatDate(entry.entryDate)} />
                  </dl>
                  {entry.status === 'active' && (
                    <div className="border-t px-5 py-3">
                      <Button asChild variant="outline" size="sm">
                        <Link
                          to="/zaswiadczenie/$pwz"
                          params={{ pwz: entry.pwz }}
                          target="_blank"
                          rel="noopener"
                        >
                          <FileText className="size-4" />
                          Zaświadczenie o posiadaniu tytułu (PDF)
                        </Link>
                      </Button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ))}
      </section>
    </div>
  )
}

const STATUS_BADGES: Record<EntryStatus, { label: string; className: string }> = {
  active: {
    label: 'Wpis aktywny',
    className: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  },
  suspended: {
    label: 'Wpis zawieszony',
    className: 'bg-amber-50 text-amber-800 ring-amber-200',
  },
  expired: {
    label: 'Wpis nieaktywny',
    className: 'bg-red-50 text-red-700 ring-red-200',
  },
}

function StatusBadge({ status }: { status: EntryStatus }) {
  const badge = STATUS_BADGES[status]
  return (
    <span
      className={`rounded px-2 py-1 text-xs font-semibold ring-1 ${badge.className}`}
    >
      {badge.label}
    </span>
  )
}

function Field({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={mono ? 'mt-1 font-mono text-lg' : 'mt-1 text-base'}>
        {value}
      </dd>
    </div>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed bg-white px-5 py-6 text-center text-muted-foreground">
      {children}
    </div>
  )
}
