import { useCallback, useEffect, useState } from 'react'
import { EmptyState } from '@/components/empty-state'
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
  new_device: 'Logowanie z nowego urządzenia',
  new_country: 'Logowanie z nowego kraju',
  two_countries: 'Logowania z dwóch krajów w krótkim czasie',
  superadmin_granted: 'Nadano uprawnienia superadmina (współwłaściciel)',
  odd_hours: 'Logowanie o nietypowej porze',
  tor_login: 'Logowanie przez sieć Tor',
  pesel_sequence: 'Odsłanianie PESEL kolejnych wpisów (skanowanie)',
  pesel_quota: 'Wyczerpany dzienny limit odsłonięć PESEL',
  pesel_changed: 'Zmiana numeru PESEL we wpisie',
  mass_delete: 'Masowe usuwanie wpisów',
  mass_status: 'Masowa zmiana statusów',
  qr_mass_check: 'Masowe sprawdzanie kodów QR',
  pwz_guessing: 'Zgadywanie numerów PWZ/PESEL',
  ip_autoban: 'Automatyczna blokada adresu IP',
  ip_locked: 'Atak siłowy: adres zablokowany do ręcznego odblokowania',
  lockdown: 'Tryb blokady (lockdown)',
  test: 'Alarm próbny',
}

const SEVERITY: Record<string, { label: string; className: string }> = {
  low: { label: 'niski', className: 'bg-slate-100 text-slate-700 ring-slate-200' },
  medium: { label: 'średni', className: 'bg-amber-50 text-amber-800 ring-amber-200' },
  high: { label: 'wysoki', className: 'bg-orange-100 text-orange-800 ring-orange-300' },
  critical: { label: 'krytyczny', className: 'bg-red-600 text-white ring-red-700' },
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
        <EmptyState kind="calm">Brak alertów. Wszystko wygląda spokojnie.</EmptyState>
      ) : (
        <ul className="mt-4 divide-y rounded-md border">
          {rows.map((row) => (
            <li
              key={row.id}
              className={`p-3 text-sm ${row.acknowledged ? 'opacity-60' : ''}`}
            >
              <p className="font-semibold">
                {KIND_LABELS[row.kind] ?? row.kind}
                <span
                  className={`ml-2 rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ${(SEVERITY[row.severity] ?? SEVERITY.medium).className}`}
                >
                  {(SEVERITY[row.severity] ?? SEVERITY.medium).label}
                </span>
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
                {row.country ? ` · ${row.country}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
