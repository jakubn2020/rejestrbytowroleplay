import { useEffect, useState, type FormEvent } from 'react'
import { Send } from 'lucide-react'
import { toast } from 'sonner'

import { Panel } from '@/components/admin/panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  MANAGEMENT_COOLDOWN_SECONDS,
  PESEL_MAX_LENGTH,
  PROFESSIONS,
  isParamedic,
  isPesel,
  pwzFromPesel,
} from '@/lib/registry'
import { getCooldown, submitRequest } from '@/lib/requests.functions'
import { ProofPicker } from '@/components/admin/proof-picker'

export { compressImage } from '@/lib/image-compress'

const selectClass =
  'h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

function formatWait(seconds: number) {
  const m = Math.floor(seconds / 60)
  const sec = String(seconds % 60).padStart(2, '0')
  return `${m}:${sec}`
}

/** kierownictwo: ask for a new entry, with a screenshot of the person's message as proof. */
export function RequestForm({ onSubmitted }: { onSubmitted: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [pesel, setPesel] = useState('')
  const [profession, setProfession] = useState<string>(PROFESSIONS[0])
  const [proof, setProof] = useState<string | null>(null)
  const [proofName, setProofName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const paramedic = isParamedic(profession)
  const waiting = secondsLeft > 0

  useEffect(() => {
    let active = true
    getCooldown()
      .then((r) => {
        if (active) setSecondsLeft(r.secondsLeft)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(
      () => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)),
      1000,
    )
    return () => clearInterval(timer)
  }, [waiting])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    if (waiting) return
    if (!isPesel(pesel)) {
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
      const result = await submitRequest({
        data: {
          person: {
            pesel,
            firstName: String(fields.get('firstName')),
            lastName: String(fields.get('lastName')),
            profession: profession as (typeof PROFESSIONS)[number],
            specialization: paramedic
              ? undefined
              : String(fields.get('specialization') ?? ''),
          },
          proof,
        },
      })
      if (!result.ok) {
        setError(result.error)
        if (result.secondsLeft) setSecondsLeft(result.secondsLeft)
        return
      }
      setSecondsLeft(MANAGEMENT_COOLDOWN_SECONDS)
      toast.success('Wniosek wysłany do administratora.')
      form.reset()
      setPesel('')
      setProof(null)
      setProofName('')
      onSubmitted()
    } catch {
      setError('Nie udało się wysłać wniosku.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Panel>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Send className="size-5" /> Złóż wniosek o wpis
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Osobę do rejestru dodaje administrator po sprawdzeniu zrzutu ekranu
        wiadomości, w której ta osoba prosi o wpis.
      </p>
      <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="req-firstName">Imię</Label>
          <Input id="req-firstName" name="firstName" required maxLength={80} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="req-lastName">Nazwisko</Label>
          <Input id="req-lastName" name="lastName" required maxLength={80} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="req-pesel">PESEL</Label>
          <Input
            id="req-pesel"
            name="pesel"
            inputMode="numeric"
            value={pesel}
            onChange={(e) =>
              setPesel(e.target.value.replace(/\D/g, '').slice(0, PESEL_MAX_LENGTH))
            }
            required
          />
          <p className="text-xs text-muted-foreground">
            Numer PWZ:{' '}
            <span className="font-mono text-foreground">
              {isPesel(pesel) ? pwzFromPesel(pesel) : '—'}
            </span>{' '}
            (wyliczany automatycznie)
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="req-profession">Zawód</Label>
          <select
            id="req-profession"
            value={profession}
            onChange={(e) => setProfession(e.target.value)}
            className={selectClass}
          >
            {PROFESSIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="req-specialization">Specjalizacja (opcjonalnie)</Label>
          {paramedic ? (
            <Input id="req-specialization" value="nd." disabled />
          ) : (
            <Input
              id="req-specialization"
              name="specialization"
              placeholder="np. chirurgia ogólna"
              maxLength={160}
            />
          )}
        </div>
        <div className="sm:col-span-2">
          <ProofPicker
            id="req-proof"
            label="Zrzut ekranu wiadomości (dowód, że osoba chce wpis)"
            proof={proof}
            proofName={proofName}
            onChange={(value, name) => {
              setProof(value)
              setProofName(name)
            }}
            onError={setError}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">
            {error}
          </p>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={pending || waiting}>
            {pending
              ? 'Wysyłanie…'
              : waiting
                ? `Kolejny wniosek możesz złożyć za ${formatWait(secondsLeft)}`
                : 'Wyślij wniosek'}
          </Button>
          {!waiting && (
            <p className="mt-2 text-xs text-muted-foreground">
              Konto kierownictwa może złożyć jeden wniosek na 5 minut.
            </p>
          )}
        </div>
      </form>
    </Panel>
  )
}
