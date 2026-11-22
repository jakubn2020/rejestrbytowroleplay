import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { getBranding, saveBranding } from '@/lib/branding.functions'

const MAX_BYTES = 200 * 1024

/** Owner only: own logo in the header and the switch for the e-mail watermark over the panel. */
export function BrandingSection() {
  const [logo, setLogo] = useState<string | null>(null)
  const [watermark, setWatermark] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getBranding()
      .then((branding) => {
        setLogo(branding.logo)
        setWatermark(branding.watermark)
      })
      .catch(() => toast.error('Nie udało się wczytać ustawień wyglądu.'))
      .finally(() => setLoaded(true))
  }, [])

  function pick(file: File | undefined) {
    if (!file) return
    if (file.size > MAX_BYTES) {
      toast.error('Plik jest za duży (maksymalnie 200 KB).')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result)
      if (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(result)) {
        toast.error('Dozwolone formaty: PNG, JPEG, WebP, SVG.')
        return
      }
      setLogo(result)
    }
    reader.readAsDataURL(file)
  }

  async function save() {
    setBusy(true)
    try {
      await saveBranding({ data: { logo, watermark } })
      toast.success('Zapisano. Zmiana jest widoczna po odświeżeniu stron.')
    } catch {
      toast.error('Nie udało się zapisać (sprawdź rozmiar i format logo).')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return null
  return (
    <div className="space-y-4 rounded-md border p-4">
      <h3 className="text-sm font-semibold">Wygląd strony i znak wodny</h3>
      <div className="space-y-2">
        <p className="text-sm font-medium">Logo w nagłówku</p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-14 min-w-14 items-center justify-center rounded bg-[var(--registry-navy)] p-2">
            {logo ? <img src={logo} alt="Podgląd logo" className="h-10 w-auto max-w-[6rem] object-contain" /> : <span className="text-xs text-white/70">brak</span>}
          </div>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => pick(e.target.files?.[0])} className="text-xs" aria-label="Wybierz plik logo" />
          {logo && <Button type="button" variant="outline" size="sm" onClick={() => setLogo(null)}>Usuń logo</Button>}
        </div>
        <p className="text-xs text-muted-foreground">PNG, JPEG, WebP lub SVG do 200 KB. Najlepiej na przezroczystym tle, jasne na ciemnym nagłówku.</p>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} />
        <span>
          Znak wodny z adresem e-mail na panelu (dla wszystkich kont)
          <span className="block text-xs text-muted-foreground">Po wyłączeniu zrzuty ekranu panelu nie wskażą, kto je zrobił. Tylko właściciel może to zmienić.</span>
        </span>
      </label>
      <Button size="sm" disabled={busy} onClick={() => void save()}>Zapisz wygląd</Button>
    </div>
  )
}
