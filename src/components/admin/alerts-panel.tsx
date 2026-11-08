import { useCallback, useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'

import { Panel } from '@/components/admin/panel'
import { Button } from '@/components/ui/button'
import { acknowledgeAlerts, listAlerts, type AlertRow } from '@/lib/alerts.functions'
import { formatDateTime } from '@/lib/registry'

const KIND_LABELS: Record<string, string> = {
  login_failures_ip: 'Wiele nieudanych logowań z jednego adresu',
  login_failures_account: 'Wiele nieudanych logowań na jedno konto',
  mfa_lockout: 'Zgadywanie kodu z e-maila',
  lookup_limit: 'Zgadywanie numerów PESEL/PWZ',
  pesel_mass_view: 'Masowe odsłanianie numerów PESEL',
  new_ip: 'Logowanie z nowego adresu IP',
}

/** Admin: security alerts (failed logins, guessing, PESEL reveals, new addresses). */
export function AlertsPanel({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<AlertRow[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setRows(await listAlerts())
    } catch {
      setFailed(true)
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function markAllRead() {
    try {
      await acknowledgeAlerts({ data: {} })
      await load()
      onChanged()
    } catch {
      toast.error('Nie udało się oznaczyć alertów.')
    }
  }

  const unread = rows?.filter((r) => !r.acknowledged).length ?? 0

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ShieldAlert className="size-5" /> Alerty bezpieczeństwa
          {rows && !failed ? ` (nieprzeczytane: ${unread})` : ''}
        </h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Odśwież
          </Button>
          <Button size="sm" disabled={unread === 0} onClick={() => void markAllRead()}>
            Oznacz wszystkie jako przeczytane
          </Button>
        </div>
      </div>
      {rows === null ? (
        <p className="mt-4 text-muted-foreground">Wczytywanie…</p>
      ) : failed ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          Nie udało się wczytać alertów.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-muted-foreground">Brak alertów. Wszystko wygląda spokojnie.</p>
      ) : (
        <ul className="mt-4 divide-y rounded-md border">
          {rows.map((row) => (
            <li
              key={row.id}
              className={`p-3 text-sm ${row.acknowledged ? 'opacity-60' : ''}`}
            >
              <p className="font-semibold">
                {KIND_LABELS[row.kind] ?? row.kind}
                {!row.acknowledged && (
                  <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700 ring-1 ring-red-200">
                    nowy
                  </span>
                )}
              </p>
              <p>{row.details}</p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(row.createdAt)}
                {row.ip ? ` · IP ${row.ip}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
