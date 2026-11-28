import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent as ReactClipboardEvent } from 'react'
import { ClipboardPaste, Paperclip, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { compressImage } from '@/lib/image-compress'

const PASTED_NAME = 'Wklejony zrzut ekranu'

/** The first image in a clipboard event, or null. */
function imageFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile()
  }
  return null
}

/**
 * Screenshot proof that is PASTED from the clipboard (Ctrl+V, or the button) instead of picked from a file.
 * Paste works while the box or any field of the surrounding form is focused. Choosing a file stays available
 * as a small fallback for browsers or phones that cannot read the clipboard.
 */
export function ProofPicker({
  id,
  label,
  proof,
  proofName,
  onChange,
  onError,
  previewClass = 'max-h-56',
}: {
  id: string
  label: string
  proof: string | null
  proofName: string
  onChange: (proof: string | null, name: string) => void
  onError: (message: string | null) => void
  previewClass?: string
}) {
  const zoneRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)

  async function take(file: File, name: string) {
    onError(null)
    if (!file.type.startsWith('image/')) {
      onError('Dołącz zrzut ekranu jako obraz.')
      return
    }
    setBusy(true)
    try {
      onChange(await compressImage(file), name)
    } catch {
      onChange(null, '')
      onError('Nie udało się wczytać zrzutu ekranu. Spróbuj skopiować go jeszcze raz.')
    } finally {
      setBusy(false)
    }
  }

  // Ctrl+V anywhere inside the surrounding form (a text field being focused is fine).
  useEffect(() => {
    const form = zoneRef.current?.closest('form')
    if (!form) return
    const listener = (event: ClipboardEvent) => {
      const file = imageFromClipboard(event.clipboardData)
      if (!file) return
      event.preventDefault()
      void take(file, PASTED_NAME)
    }
    form.addEventListener('paste', listener)
    return () => form.removeEventListener('paste', listener)
    // `take` only uses the stable callbacks passed in as props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange, onError])

  function onPaste(event: ReactClipboardEvent<HTMLDivElement>) {
    // Already handled by the form listener when the box sits inside a form.
    if (zoneRef.current?.closest('form')) return
    const file = imageFromClipboard(event.clipboardData)
    if (!file) return
    event.preventDefault()
    void take(file, PASTED_NAME)
  }

  async function pasteFromButton() {
    onError(null)
    try {
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'))
        if (type) {
          const blob = await item.getType(type)
          await take(new File([blob], 'zrzut.png', { type }), PASTED_NAME)
          return
        }
      }
      onError('W schowku nie ma obrazu. Zrób zrzut ekranu (np. Win+Shift+S) i spróbuj ponownie.')
    } catch {
      onError('Przeglądarka nie pozwoliła odczytać schowka. Kliknij ramkę poniżej i naciśnij Ctrl+V.')
    }
  }

  function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void take(file, file.name)
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div
        ref={zoneRef}
        id={id}
        tabIndex={0}
        role="group"
        aria-label={`${label}: wklej obraz ze schowka (Ctrl+V)`}
        onPaste={onPaste}
        className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-input bg-muted/30 p-3 text-center text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <p className="text-muted-foreground">
          {busy ? 'Przetwarzanie obrazu…' : 'Skopiuj zrzut ekranu i wklej go tutaj (Ctrl+V)'}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void pasteFromButton()}>
            <ClipboardPaste className="size-4" /> Wklej ze schowka
          </Button>
          <label className="cursor-pointer text-xs text-muted-foreground underline">
            lub wybierz plik
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={pickFile} className="sr-only" />
          </label>
        </div>
      </div>
      {proof && (
        <div className="space-y-1">
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Paperclip className="size-3" /> {proofName}
            <button
              type="button"
              aria-label="Usuń zrzut ekranu"
              className="ml-1 rounded p-0.5 hover:bg-muted"
              onClick={() => onChange(null, '')}
            >
              <X className="size-3" />
            </button>
          </p>
          <img src={proof} alt="Podgląd zrzutu ekranu" className={`${previewClass} rounded border object-contain`} />
        </div>
      )}
    </div>
  )
}
