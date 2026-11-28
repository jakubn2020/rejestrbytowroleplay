import { useState, type FormEvent } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { consumePasswordReset } from '@/lib/password-reset.functions'
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES_ERROR,
  PASSWORD_RULES_TEXT,
  meetsPasswordPolicy,
} from '@/lib/password-strength'

export const Route = createFileRoute('/reset-hasla')({
  head: () => ({
    meta: [{ title: 'Ustaw nowe hasło – Centralny Rejestr' }, { name: 'robots', content: 'noindex' }],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : '',
  }),
  component: ResetPage,
})

function ResetPage() {
  const { token } = Route.useSearch()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const password = String(fields.get('password'))
    if (!meetsPasswordPolicy(password)) {
      setError(PASSWORD_RULES_ERROR)
      return
    }
    if (password !== String(fields.get('confirm'))) {
      setError('Hasła nie są takie same.')
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await consumePasswordReset({ data: { token, password } })
      if (result.ok) setDone(true)
      else setError(result.error)
    } catch {
      setError('Nie udało się ustawić hasła. Sprawdź, czy hasło spełnia wymagania (min. 10 znaków, cyfra i znak specjalny).')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto max-w-md px-5 py-12">
      <h1 className="font-[family-name:var(--font-heading)] text-2xl font-bold text-[var(--registry-navy)]">
        Ustaw nowe hasło
      </h1>
      {done ? (
        <div className="mt-6 rounded-lg border bg-white p-5 shadow-sm">
          <p>Hasło zostało zmienione. Możesz się teraz zalogować.</p>
          <Button asChild className="mt-4">
            <Link to="/admin">Przejdź do logowania</Link>
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-3 rounded-lg border bg-white p-5 shadow-sm">
          <div className="space-y-2">
            <Label htmlFor="reset-password">Nowe hasło</Label>
            <Input id="reset-password" name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required />
            <p className="text-xs text-muted-foreground">{PASSWORD_RULES_TEXT}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reset-confirm">Powtórz nowe hasło</Label>
            <Input id="reset-confirm" name="confirm" type="password" autoComplete="new-password" required />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending || token === ''}>
            {pending ? 'Zapisywanie…' : 'Ustaw hasło'}
          </Button>
        </form>
      )}
    </div>
  )
}
