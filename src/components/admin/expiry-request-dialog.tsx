import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Paperclip } from 'lucide-react'
import { toast } from 'sonner'

import {
  ExpiryField,
  resolveExpiry,
  type ExpiryChoice,
} from '@/components/admin/expiry-field'
import { compressImage } from '@/components/admin/request-form'
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
import { submitExpiryRequest } from '@/lib/expiry-requests.functions'
import { validityLabel } from '@/lib/registry'

type Person = {
  id: number
  firstName: string
  lastName: string
  expiresAt: string | null
}

const INITIAL: ExpiryChoice = { mode: 'months3', amount: '', unit: 'months' }

/** kierownictwo: asks an admin to change the PWZ validity of one person (screenshot required). */
export function ExpiryRequestDialog({
  person,
  onClose,
  onSubmitted,
}: {
  person: Person | null
  onClose: () => void
  onSubmitted: () => void
}) {
  const [choice, setChoice] = useState<ExpiryChoice>(INITIAL)
  const [proof, setProof] = useState<string | null>(null)
  const [proofName, setProofName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    setChoice(INITIAL)
    setProof(null)
    setProofName('')
    setError(null)
    onClose()
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
    if (!person) return
    const resolved = resolveExpiry(choice)
    if (!resolved.ok) {
      setError(resolved.error)
      return
    }
    if (!proof) {
      setError('Dołącz zrzut ekranu wiadomości, w której osoba prosi o zmianę.')
      return
    }
    setPending(true)
    setError(null)
    try {
      const mode =
        choice.mode === 'lifetime' ? 'lifetime' : choice.mode === 'months3' ? 'months3' : 'custom'
      const result = await submitExpiryRequest({
        data: {
          practitionerId: person.id,
          mode,
          amount: mode === 'custom' ? Number(choice.amount) : undefined,
          unit: mode === 'custom' ? choice.unit : undefined,
          proof,
        },
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success('Wniosek o zmianę terminu wysłany do administratora.')
      close()
      onSubmitted()
    } catch {
      setError('Nie udało się wysłać wniosku.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={person !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Wniosek o zmianę terminu: {person?.firstName} {person?.lastName}
          </DialogTitle>
          <DialogDescription>
            Obecnie: {validityLabel(person?.expiresAt ?? null)}. Termin zmienia
            administrator po sprawdzeniu zrzutu ekranu. Nowy termin liczy się od
            dnia akceptacji.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <ExpiryField id="req-expiry" value={choice} onChange={setChoice} />
          <div className="space-y-2">
            <Label htmlFor="req-expiry-proof">
              Zrzut ekranu wiadomości (dowód, że osoba o to prosi)
            </Label>
            <Input
              id="req-expiry-proof"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => void pickFile(e)}
            />
            {proof && (
              <div className="space-y-1">
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Paperclip className="size-3" /> {proofName}
                </p>
                <img
                  src={proof}
                  alt="Podgląd zrzutu ekranu"
                  className="max-h-48 rounded border object-contain"
                />
              </div>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Anuluj
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Wysyłanie…' : 'Wyślij wniosek'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
