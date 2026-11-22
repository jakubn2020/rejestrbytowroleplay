import { useState, type FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDate } from '@/lib/registry'
import {
  REPORT_CATEGORIES,
  checkReportStatus,
  submitReport,
  type ReportStatusResult,
} from '@/lib/reports.functions'

export const Route = createFileRoute('/zglos-blad')({
  head: () => ({
    meta: [{ title: 'Kontakt i zgłoszenia – Centralny Rejestr' }],
  }),
  component: ReportPage,
})

function ReportPage() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [code, setCode] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    try {
      const result = await submitReport({
        data: {
          category: String(fields.get('category') ?? 'data') as keyof typeof REPORT_CATEGORIES,
          subject: String(fields.get('subject') ?? ''),
          message: String(fields.get('message') ?? ''),
          contact: String(fields.get('contact') ?? ''),
          website: String(fields.get('website') ?? ''),
        },
      })
      if (result.ok) {
        setCode(result.code ?? null)
        setDone(true)
      }
      else setError(result.error)
    } catch {
      setError('Sprawdź, czy opis ma co najmniej 10 znaków, i spróbuj ponownie.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl px-5 py-12 sm:py-16">
      <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-[var(--registry-navy)]">
        Kontakt i zgłoszenia
      </h1>
      <p className="mt-3 text-muted-foreground">
        Zauważyłeś nieprawidłowe dane, chcesz usunąć wpis albo masz pytanie? Wybierz
        rodzaj sprawy i opisz ją poniżej. Zgłoszenie trafi do administratorów.
      </p>

      {done ? (
        <div
          role="status"
          className="mt-8 rounded-lg border bg-white p-6 text-center shadow-sm"
        >
          <p className="text-lg font-semibold">Dziękujemy, zgłoszenie zostało wysłane.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Administratorzy sprawdzą je tak szybko, jak to możliwe.
          </p>
          {code && (
            <p className="mt-4 text-sm">
              Numer zgłoszenia: <strong className="font-mono text-base">{code}</strong>
              <span className="mt-1 block text-xs text-muted-foreground">
                Zapisz go. Pozwoli sprawdzić status zgłoszenia poniżej na tej stronie.
              </span>
            </p>
          )}
        </div>
      ) : (
        <form
          onSubmit={submit}
          className="mt-8 space-y-4 rounded-lg border bg-white p-6 shadow-sm"
        >
          <div className="space-y-2">
            <Label htmlFor="category">Rodzaj sprawy</Label>
            <select
              id="category"
              name="category"
              defaultValue="data"
              className="h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-xs"
            >
              {Object.entries(REPORT_CATEGORIES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="subject">Czego dotyczy zgłoszenie?</Label>
            <Input
              id="subject"
              name="subject"
              placeholder="Numer PWZ, imię i nazwisko albo temat"
              maxLength={120}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="message">Opisz sprawę</Label>
            <textarea
              id="message"
              name="message"
              rows={5}
              minLength={10}
              maxLength={1000}
              required
              className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contact">Kontakt (opcjonalnie)</Label>
            <Input
              id="contact"
              name="contact"
              placeholder="np. nick na Discordzie"
              maxLength={100}
            />
          </div>
          {/* Honeypot: hidden from people, bots tend to fill it in. */}
          <div className="hidden" aria-hidden>
            <label>
              Nie wypełniaj tego pola
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending ? 'Wysyłanie…' : 'Wyślij zgłoszenie'}
          </Button>
        </form>
      )}
      <StatusCheck />
    </div>
  )
}

function StatusCheck() {
  const [code, setCode] = useState('')
  const [result, setResult] = useState<ReportStatusResult | 'error' | null>(null)
  const [pending, setPending] = useState(false)

  async function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    try {
      setResult(await checkReportStatus({ data: { code } }))
    } catch {
      setResult('error')
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={check} className="mt-8 space-y-3 rounded-lg border bg-white p-6 shadow-sm">
      <h2 className="font-semibold">Sprawdź status zgłoszenia</h2>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Numer zgłoszenia, np. ZG-12-A1B2C3"
          aria-label="Numer zgłoszenia"
          className="font-mono"
          required
        />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? 'Sprawdzam…' : 'Sprawdź'}
        </Button>
      </div>
      <div aria-live="polite" className="text-sm">
        {result === 'error' && <p className="text-destructive">Numer ma nieprawidłowy format (ZG-liczba-6 znaków).</p>}
        {result && result !== 'error' && !result.found && (
          <p className="text-muted-foreground">Nie znaleziono zgłoszenia o takim numerze.</p>
        )}
        {result && result !== 'error' && result.found && (
          <p>
            {result.status === 'done'
              ? `Zgłoszenie rozpatrzone${result.handledAt ? ` (${formatDate(result.handledAt)})` : ''}.`
              : 'Zgłoszenie czeka na sprawdzenie przez administratorów.'}{' '}
            <span className="text-muted-foreground">Wysłano {formatDate(result.createdAt)}.</span>
          </p>
        )}
      </div>
    </form>
  )
}
