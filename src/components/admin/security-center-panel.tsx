import { useCallback, useEffect, useState } from 'react'
import { LogOut, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

import { Panel } from '@/components/admin/panel'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/registry'
import {
  getSecurityOverview,
  listAllSessions,
  listSecurityEvents,
  signOutAccount,
  signOutEveryone,
  type ActiveSession,
  type SecurityEventRow,
  type SecurityOverview,
} from '@/lib/security-center.functions'

const KIND_LABELS: Record<string, string> = {
  login: 'Logowanie',
  login_failed: 'Nieudane logowanie',
  login_failures_ip: 'Alert: nieudane logowania z adresu',
  login_failures_account: 'Alert: nieudane logowania na konto',
  mfa_lockout: 'Zablokowany kod e-mail',
  lookup_limit: 'Limit wyszukiwań',
  pesel_view: 'Odsłonięcie PESEL',
  pesel_mass_view: 'Alert: masowe odsłanianie PESEL',
  new_ip: 'Alert: nowy adres IP',
  new_device: 'Alert: nowe urządzenie',
  report: 'Zgłoszenie błędu',
}

function browser(ua: string | null) {
  if (!ua) return 'nieznane urządzenie'
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'przeglądarka'
  const s = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'system'
  return `${b}, ${s}`
}

/** Owner only: the security centre (overview, every session, emergency sign-out, event trail). */
export function SecurityCenterPanel() {
  const [overview, setOverview] = useState<SecurityOverview | null>(null)
  const [sessions, setSessions] = useState<ActiveSession[]>([])
  const [events, setEvents] = useState<SecurityEventRow[]>([])
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const [o, s, e] = await Promise.all([
        getSecurityOverview(),
        listAllSessions(),
        listSecurityEvents(),
      ])
      setOverview(o)
      setSessions(s)
      setEvents(e)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function signOutOne(identity: string) {
    if (!window.confirm(`Wylogować konto ${identity} ze wszystkich urządzeń?`)) return
    setBusy(true)
    try {
      await signOutAccount({ data: { identity } })
      toast.success('Konto wylogowane.')
      await load()
    } catch {
      toast.error('Nie udało się wylogować konta.')
    } finally {
      setBusy(false)
    }
  }

  async function signOutAll() {
    if (!window.confirm('Wylogować WSZYSTKICH użytkowników panelu (oprócz Ciebie w tej przeglądarce)?')) return
    setBusy(true)
    try {
      await signOutEveryone()
      toast.success('Wszyscy użytkownicy zostali wylogowani.')
      await load()
    } catch {
      toast.error('Nie udało się wylogować użytkowników.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="size-5" /> Centrum bezpieczeństwa
        </h2>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Odśwież
          </Button>
          <Button variant="destructive" size="sm" disabled={busy} onClick={() => void signOutAll()}>
            <LogOut className="size-4" /> Wyloguj wszystkich
          </Button>
        </div>
      </div>

      {failed ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          Nie udało się wczytać danych.
        </p>
      ) : overview === null ? (
        <p className="mt-4 text-muted-foreground">Wczytywanie…</p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Tile label="Aktywne sesje" value={overview.activeSessions} />
            <Tile label="Zalogowane konta" value={overview.signedInAccounts} />
            <Tile label="Otwarte alerty" value={overview.openAlerts} />
            <Tile label="Nieudane logowania (24 h)" value={overview.failedLogins24h} />
            <Tile label="Nowe urządzenia (7 dni)" value={overview.newDevices7d} />
            <Tile label="Odsłonięte PESEL (24 h)" value={overview.peselViews24h} />
          </dl>

          <h3 className="mt-6 text-sm font-semibold">Aktywne sesje ({sessions.length})</h3>
          {sessions.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Brak aktywnych sesji.</p>
          ) : (
            <ul className="mt-2 divide-y rounded-md border text-sm">
              {sessions.map((s) => (
                <li key={s.tokenHash} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div>
                    <p className="font-medium">{s.identity}</p>
                    <p className="text-xs text-muted-foreground">
                      {browser(s.userAgent)} · {s.ip ?? 'adres nieznany'} · od {formatDateTime(s.createdAt)}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void signOutOne(s.identity)}>
                    Wyloguj konto
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-6 text-sm font-semibold">Ostatnie zdarzenia bezpieczeństwa</h3>
          <ul className="mt-2 max-h-96 divide-y overflow-y-auto rounded-md border text-sm">
            {events.map((e) => (
              <li key={e.id} className="px-3 py-2">
                <p className={e.isAlert ? 'font-semibold text-destructive' : 'font-medium'}>
                  {KIND_LABELS[e.kind] ?? e.kind}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(e.createdAt)} · {e.identity ?? 'brak konta'} · {e.ip ?? 'brak adresu'}
                </p>
                {e.details && !e.details.startsWith('device:') && (
                  <p className="text-xs text-muted-foreground">{e.details}</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border px-3 py-3 text-center">
      <dd className="font-[family-name:var(--font-heading)] text-2xl font-bold">{value}</dd>
      <dt className="mt-1 text-xs text-muted-foreground">{label}</dt>
    </div>
  )
}
