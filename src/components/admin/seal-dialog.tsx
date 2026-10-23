import { useEffect, useState, type ChangeEvent } from 'react'
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
import { Label } from '@/components/ui/label'
import { getSeal, removeSeal, saveSeal } from '@/lib/certificate.functions'

const MAX_BYTES = 500 * 1024

/** Admin: upload the seal image that is printed on certificates. */
export function SealDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [seal, setSeal] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError(null)
    getSeal()
      .then((result) => {
        if (active) setSeal(result.seal)
      })
      .catch(() => {
        if (active) setError('Nie udało się wczytać pieczęci.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open])

  function upload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError('Wgraj obraz PNG, JPEG lub WebP.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('Obraz jest zbyt duży (maksymalnie 500 KB).')
      return
    }
    const reader = new FileReader()
    reader.onerror = () => setError('Nie udało się odczytać pliku.')
    reader.onload = async () => {
      setPending(true)
      setError(null)
      try {
        const dataUrl = String(reader.result)
        const result = await saveSeal({ data: { dataUrl } })
        if (!result.ok) {
          setError(result.error)
          return
        }
        setSeal(dataUrl)
        toast.success('Pieczęć zapisana.')
      } catch {
        setError('Nie udało się zapisać pieczęci.')
      } finally {
        setPending(false)
      }
    }
    reader.readAsDataURL(file)
  }

  async function remove() {
    if (!confirm('Usunąć pieczęć? Zaświadczenia będą wydawane bez pieczęci.')) {
      return
    }
    setPending(true)
    setError(null)
    try {
      await removeSeal()
      setSeal(null)
      toast.success('Pieczęć usunięta.')
    } catch {
      setError('Nie udało się usunąć pieczęci.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pieczęć na zaświadczeniach</DialogTitle>
          <DialogDescription>
            Wgraj obraz pieczęci (PNG, JPEG lub WebP, do 500 KB, najlepiej z
            przezroczystym tłem). Zostanie wydrukowana na zaświadczeniach o
            posiadaniu tytułu.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed bg-muted/40 p-4">
            {loading ? (
              <p className="text-sm text-muted-foreground">Wczytywanie…</p>
            ) : seal ? (
              <img src={seal} alt="Podgląd pieczęci" className="max-h-40" />
            ) : (
              <p className="text-sm text-muted-foreground">
                Brak pieczęci. Zaświadczenia mają puste miejsce na pieczęć.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="seal-file">
              {seal ? 'Zastąp pieczęć' : 'Wgraj pieczęć'}
            </Label>
            <input
              id="seal-file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={upload}
              disabled={pending}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-white file:px-3 file:py-1.5 file:text-sm"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          {seal && (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => void remove()}
            >
              Usuń pieczęć
            </Button>
          )}
          <Button type="button" onClick={onClose}>
            Zamknij
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
