import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  listMySessions,
  revokeAllSessions,
  revokeSession,
  type SessionRow,
} from '@/lib/mfa.functions'
import { formatDateTime } from '@/lib/registry'

/** Short, human-readable description of a browser from its user agent. */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Nieznane urządzenie'
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : 'Przeglądarka'
  const system = /Windows/.test(userAgent)
    ? 'Windows'
    : /Android/.test(userAgent)
      ? 'Android'
      : /iPhone|iPad/.test(userAgent)
        ? 'iOS'
        : /Mac OS/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : ''
  return system ? `${browser}, ${system}` : browser
}

/** Lists the devices signed in to the panel and lets the user sign them out. */
export function SessionsDialog({
  open,
  onClose,
  onSignedOutEverywhere,
}: {
  open: boolean
  onClose: () => void
  /** Called after "log out everywhere" (this browser is signed out too). */
  onSignedOutEverywhere: () => void
}) {
  const [rows, setRows] = useState<SessionRow[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setRows(await listMySessions())
    } catch {
      setFailed(true)
      setRows([])
    }
  }, [])

  useEffect(() => {
    if (open) {
      setRows(null)
      void load()
    }
  }, [open, load])

  async function revoke(row: SessionRow) {
    try {
      await revokeSession({ data: { id: row.id } })
      await load()
    } catch {
      toast.error('Nie udało się wylogować tego urządzenia.')
    }
  }

  async function revokeAll() {
    if (!confirm('Wylogować ze wszystkich urządzeń, także z tego?')) return
    try {
      await revokeAllSessions()
      toast.success('Wylogowano ze wszystkich urządzeń.')
      onClose()
      onSignedOutEverywhere()
    } catch {
      toast.error('Nie udało się wylogować.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Zalogowane urządzenia</DialogTitle>
          <DialogDescription>
            Przeglądarki, które mają teraz dostęp do panelu na tym koncie. Jeśli
            widzisz nieznane urządzenie, wyloguj je i zmień hasło.
          </DialogDescription>
        </DialogHeader>
        {rows === null ? (
          <p className="text-muted-foreground">Wczytywanie…</p>
        ) : failed ? (
          <p role="alert" className="text-sm text-destructive">
            Nie udało się wczytać listy urządzeń.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground">Brak aktywnych sesji.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <div>
                  <p className="font-medium">
                    {describeDevice(row.userAgent)}
                    {row.current && (
                      <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700 ring-1 ring-emerald-200">
                        to urządzenie
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Zalogowano {formatDateTime(row.createdAt)}
                    {row.ip ? ` · IP ${row.ip}` : ''} · wygasa {formatDateTime(row.expiresAt)}
                  </p>
                </div>
                {!row.current && (
                  <Button variant="outline" size="sm" onClick={() => void revoke(row)}>
                    Wyloguj
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end">
          <Button variant="destructive" onClick={() => void revokeAll()}>
            Wyloguj ze wszystkich urządzeń
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
