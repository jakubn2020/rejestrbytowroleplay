import { useState, type FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { submitReport } from '@/lib/reports.functions'

export const Route = createFileRoute('/zglos-blad')({
  head: () => ({
    meta: [{ title: 'Zgłoś błąd w rejestrze – Centralny Rejestr' }],
  }),
  component: ReportPage,
})

function ReportPage() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    try {
      const result = await submitReport({
        data: {
          subject: String(fields.get('subject') ?? ''),
          message: String(fields.get('message') ?? ''),
          contact: String(fields.get('contact') ?? ''),
          website: String(fields.get('website') ?? ''),
        },
      })
      if (result.ok) setDone(true)
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
        Zgłoś błąd w rejestrze
      </h1>
      <p className="mt-3 text-muted-foreground">
        Zauważyłeś nieprawidłowe dane albo wpis, który nie powinien się tu
        znajdować? Opisz to poniżej. Zgłoszenie trafi do administratorów.
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
        </div>
      ) : (
        <form
          onSubmit={submit}
          className="mt-8 space-y-4 rounded-lg border bg-white p-6 shadow-sm"
        >
          <div className="space-y-2">
            <Label htmlFor="subject">Którego wpisu dotyczy zgłoszenie?</Label>
            <Input
              id="subject"
              name="subject"
              placeholder="Numer PWZ albo imię i nazwisko"
              maxLength={120}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="message">Co jest nie tak?</Label>
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
    </div>
  )
}
