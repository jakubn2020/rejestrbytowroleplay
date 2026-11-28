import { useCallback, useEffect, useState } from 'react'
import { LogOut, ShieldCheck } from 'lucide-react'

import { SecurityAccountsTab } from '@/components/admin/security-accounts-tab'
import { SecurityDataTab } from '@/components/admin/security-data-tab'
import { SecurityIncidentsTab } from '@/components/admin/security-incidents-tab'
import { SecurityNetworkTab } from '@/components/admin/security-network-tab'
import { toast } from 'sonner'

import { Panel } from '@/components/admin/panel'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/registry'
import {
  getSecurityOverview,
  listSecurityEvents,
  signOutEveryone,
  type SecurityEventRow,
  type SecurityOverview,
} from '@/lib/security-center.functions'
import { getSecurityScore, sendTestAlert, type ScoreItem } from '@/lib/security-ops.functions'

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
  new_country: 'Alert: nowy kraj',
  two_countries: 'Alert: dwa kraje naraz',
  superadmin_granted: 'Alert: nadano uprawnienia superadmina',
  odd_hours: 'Alert: nietypowa pora',
  tor_login: 'Alert: logowanie przez Tor',
  pesel_sequence: 'Alert: skanowanie PESEL',
  pesel_quota: 'Alert: limit PESEL',
  pesel_changed: 'Alert: zmiana PESEL',
  mass_delete: 'Alert: masowe usuwanie',
  mass_status: 'Alert: masowa zmiana statusów',
  qr_mass_check: 'Alert: masowe sprawdzanie QR',
  pwz_guessing: 'Alert: zgadywanie numerów',
  ip_autoban: 'Automatyczna blokada IP',
  ip_locked: 'Alert: adres zablokowany (atak siłowy)',
  lockdown: 'Alert: lockdown',
  test: 'Alarm próbny',
  report: 'Zgłoszenie błędu',
}

type Tab = 'overview' | 'accounts' | 'network' | 'incidents' | 'data'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Przegląd' },
  { id: 'accounts', label: 'Konta i sesje' },
  { id: 'network', label: 'Adresy IP i ruch' },
  { id: 'incidents', label: 'Incydenty i awaria' },
  { id: 'data', label: 'Dane i ustawienia' },
]

/** Owner only: the security centre. */
export function SecurityCenterPanel() {
  const [tab, setTab] = useState<Tab>('overview')
  return (
    <Panel>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <ShieldCheck className="size-5" /> Centrum bezpieczeństwa
      </h2>
      <div className="mt-3 flex flex-wrap gap-2" role="tablist">
        {TABS.map((t) => (
          <Button key={t.id} role="tab" aria-selected={tab === t.id} size="sm" variant={tab === t.id ? 'default' : 'outline'} onClick={() => setTab(t.id)}>
            {t.label}
          </Button>
        ))}
      </div>
      <div className="mt-5">
        {tab === 'overview' && <OverviewTab />}
        {tab === 'accounts' && <SecurityAccountsTab />}
        {tab === 'network' && <SecurityNetworkTab />}
        {tab === 'incidents' && <SecurityIncidentsTab />}
        {tab === 'data' && <SecurityDataTab />}
      </div>
    </Panel>
  )
}

function OverviewTab() {
  const [overview, setOverview] = useState<SecurityOverview | null>(null)
  const [events, setEvents] = useState<SecurityEventRow[]>([])
  const [score, setScore] = useState<{ score: number; items: ScoreItem[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const [o, e, sc] = await Promise.all([getSecurityOverview(), listSecurityEvents(), getSecurityScore()])
      setOverview(o)
      setEvents(e)
      setScore(sc)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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

  async function testAlert() {
    setBusy(true)
    try {
      await sendTestAlert()
      toast.success('Wysłano alarm próbny (zobacz Alerty, e-mail tylko gdy skonfigurowano Resend).')
      await load()
    } catch {
      toast.error('Nie udało się wysłać alarmu próbnego.')
    } finally {
      setBusy(false)
    }
  }

  if (failed) return <p role="alert" className="text-sm text-destructive">Nie udało się wczytać danych.</p>
  if (overview === null || score === null) return <p className="text-muted-foreground">Wczytywanie…</p>

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => void load()}>Odśwież</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void testAlert()}>Alarm próbny</Button>
        <Button variant="destructive" size="sm" disabled={busy} onClick={() => void signOutAll()}>
          <LogOut className="size-4" /> Wyloguj wszystkich
        </Button>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label="Aktywne sesje" value={overview.activeSessions} />
        <Tile label="Zalogowane konta" value={overview.signedInAccounts} />
        <Tile label="Otwarte alerty" value={overview.openAlerts} />
        <Tile label="Nieudane logowania (24 h)" value={overview.failedLogins24h} />
        <Tile label="Nowe urządzenia (7 dni)" value={overview.newDevices7d} />
        <Tile label="Odsłonięte PESEL (24 h)" value={overview.peselViews24h} />
      </dl>

      <div className="rounded-md border p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Ocena bezpieczeństwa</h3>
          <span className={`font-[family-name:var(--font-heading)] text-3xl font-bold ${score.score >= 80 ? 'text-emerald-700' : score.score >= 50 ? 'text-amber-700' : 'text-red-700'}`}>{score.score}/100</span>
        </div>
        <ul className="mt-3 space-y-1.5 text-sm">
          {score.items.map((item) => (
            <li key={item.label} className="flex gap-2">
              <span aria-hidden className={item.ok ? 'text-emerald-700' : 'text-red-700'}>{item.ok ? '✔' : '✘'}</span>
              <span>
                {item.label} <span className="text-xs text-muted-foreground">({item.weight} pkt)</span>
                {!item.ok && <span className="block text-xs text-muted-foreground">{item.hint}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="text-sm font-semibold">Ostatnie zdarzenia bezpieczeństwa</h3>
        <ul className="mt-2 max-h-96 divide-y overflow-y-auto rounded-md border text-sm">
          {events.map((e) => (
            <li key={e.id} className="px-3 py-2">
              <p className={e.isAlert ? 'font-semibold text-destructive' : 'font-medium'}>{KIND_LABELS[e.kind] ?? e.kind}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(e.createdAt)} · {e.identity ?? 'brak konta'} · {e.ip ?? 'brak adresu'}</p>
              {e.details && !e.details.startsWith('device:') && <p className="text-xs text-muted-foreground">{e.details}</p>}
            </li>
          ))}
        </ul>
      </div>
    </div>
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
