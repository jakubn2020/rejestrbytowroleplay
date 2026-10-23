import { useEffect, useState, type FormEvent } from 'react'
import { updateUser } from '@netlify/identity'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { setManagementPassword } from '@/lib/registry.functions'

/** Lets any signed-in user change their own password. */
export function ChangePasswordDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) setError(null)
  }, [open])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    const password = String(fields.get('password'))
    if (password.length < 8) {
      setError('Hasło musi mieć co najmniej 8 znaków.')
      return
    }
    if (password !== String(fields.get('confirm'))) {
      setError('Hasła nie są takie same.')
      return
    }
    setPending(true)
    setError(null)
    try {
      await updateUser({ password })
      toast.success('Hasło zostało zmienione.')
      form.reset()
      onClose()
    } catch {
      setError('Nie udało się zmienić hasła. Spróbuj zalogować się ponownie.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Zmień hasło</DialogTitle>
          <DialogDescription>
            Ustaw nowe hasło do swojego konta (co najmniej 8 znaków).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="own-password">Nowe hasło</Label>
            <Input
              id="own-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="own-password-confirm">Powtórz hasło</Label>
            <Input
              id="own-password-confirm"
              name="confirm"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Anuluj
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Zapisywanie…' : 'Zmień hasło'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Admin: sets a new password for a kierownictwo account. */
export function ResetManagementPasswordDialog({
  target,
  onClose,
  onDone,
}: {
  target: { id: string; email: string } | null
  onClose: () => void
  onDone: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
  }, [target])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!target) return
    const form = event.currentTarget
    const password = String(new FormData(form).get('password'))
    if (password.length < 8) {
      setError('Hasło musi mieć co najmniej 8 znaków.')
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await setManagementPassword({
        data: { id: target.id, password },
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success(`Ustawiono nowe hasło dla ${target.email}.`)
      form.reset()
      onDone()
      onClose()
    } catch {
      setError('Nie udało się ustawić hasła.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nowe hasło: {target?.email}</DialogTitle>
          <DialogDescription>
            Ustaw nowe hasło dla tego konta kierownictwa i przekaż je tej osobie.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reset-password">Nowe hasło</Label>
            <Input
              id="reset-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Anuluj
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Zapisywanie…' : 'Ustaw hasło'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
