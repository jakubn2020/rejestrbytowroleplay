import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { User } from '@netlify/identity'
import { toast } from 'sonner'

import { Panel } from '@/components/admin/panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { sendLoginCode, verifyLoginCode } from '@/lib/mfa.functions'

/** Second login step: a 6-digit code sent to the account's e-mail address. */
export function MfaForm({
  user,
  onVerified,
  onLogout,
}: {
  user: User
  onVerified: () => void
  onLogout: () => void
}) {
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [sending, setSending] = useState(false)
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const autoSent = useRef(false)

  const send = useCallback(
    async (manual: boolean) => {
      setSending(true)
      setError(null)
      try {
        const result = await sendLoginCode()
        if (result.ok) {
          setInfo(`Wysłaliśmy 6-cyfrowy kod na adres ${user.email}.`)
          if (manual) toast.success('Wysłano nowy kod.')
        } else if (!manual && result.error.startsWith('Kod został już wysłany')) {
          // e.g. the page was reloaded right after a code went out
          setInfo(`Kod został niedawno wysłany na adres ${user.email}.`)
        } else {
          setError(result.error)
        }
      } catch {
        setError('Nie udało się wysłać kodu. Spróbuj ponownie.')
      } finally {
        setSending(false)
      }
    },
    [user.email],
  )

  useEffect(() => {
    if (autoSent.current) return
    autoSent.current = true
    void send(false)
  }, [send])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!/^\d{6}$/.test(code)) {
      setError('Kod składa się z 6 cyfr.')
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await verifyLoginCode({ data: { code } })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onVerified()
    } catch {
      setError('Nie udało się sprawdzić kodu.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="max-w-md">
      <Panel>
        <h2 className="text-lg font-semibold">Potwierdź logowanie</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {info ?? 'Wysyłamy kod na Twój adres e-mail…'}
        </p>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mfa-code">Kod z e-maila</Label>
            <Input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="font-mono text-lg tracking-widest"
              required
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Sprawdzanie…' : 'Potwierdź'}
          </Button>
        </form>
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={sending}
            onClick={() => void send(true)}
          >
            {sending ? 'Wysyłanie…' : 'Wyślij kod ponownie'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onLogout}>
            Wyloguj
          </Button>
        </div>
      </Panel>
    </div>
  )
}
