import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Paperclip, Send } from 'lucide-react'
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

const selectClass =
  'h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

/** Longest side and size limit of the screenshot that is sent to the server. */
const MAX_SIDE = 1600
const MAX_CHARS = 1_800_000

function formatWait(seconds: number) {
  const m = Math.floor(seconds / 60)
  const sec = String(seconds % 60).padStart(2, '0')
  return `${m}:${sec}`
}

/** Shrinks a screenshot in the browser so it stays small enough to store (JPEG). */
async function compressImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Nie udało się odczytać obrazu'))
      img.src = url
    })
    let scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight))
    let quality = 0.82
    for (let attempt = 0; attempt < 5; attempt++) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Brak obsługi canvas')
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', quality)
      if (dataUrl.length <= MAX_CHARS) return dataUrl
      scale *= 0.75
      quality = Math.max(0.5, quality - 0.1)
    }
    throw new Error('Zrzut ekranu jest zbyt duży')
  } finally {
    URL.revokeObjectURL(url)
  }
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
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="req-proof">
            Zrzut ekranu wiadomości (dowód, że osoba chce wpis)
          </Label>
          <Input
            id="req-proof"
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
                className="max-h-56 rounded border object-contain"
              />
            </div>
          )}
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
