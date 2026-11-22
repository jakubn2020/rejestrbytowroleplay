import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { PermissionsMatrix } from '@/components/admin/permissions-matrix'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { countryLabel, remaining } from '@/lib/download'
import { formatDateTime } from '@/lib/registry'
import {
  accountHistory,
  createResetLink,
  forcePasswordChange,
  freezeAccount,
  invalidateAllPasswords,
  listAccounts,
  setTemporaryPassword,
  setAccountLock,
  signOutSession,
  type AccountRow,
  type HistoryRow,
} from '@/lib/security-accounts.functions'
import {
  listAllSessions,
  signOutAccount,
  type ActiveSession,
} from '@/lib/security-center.functions'

function browser(ua: string | null) {
  if (!ua) return 'nieznane urządzenie'
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'przeglądarka'
  const s = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'system'
  return `${b}, ${s}`
}

/** Owner only: accounts (block, freeze, password) and live sessions. */
export function SecurityAccountsTab() {
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null)
  const [sessions, setSessions] = useState<ActiveSession[]>([])
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<{ email: string; rows: HistoryRow[] } | null>(null)
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null)
  const [link, setLink] = useState<{ email: string; url: string } | null>(null)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const [a, s] = await Promise.all([listAccounts(), listAllSessions()])
      setAccounts(a)
      setSessions(s)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true)
    try {
      await action()
      toast.success(success)
      await load()
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Nie udało się wykonać akcji.')
    } finally {
      setBusy(false)
    }
  }

  async function showHistory(email: string) {
    try {
      setHistory({ email, rows: await accountHistory({ data: { email } }) })
    } catch {
      toast.error('Nie udało się wczytać historii.')
    }
  }

  async function makeLink(email: string) {
    try {
      const result = await createResetLink({ data: { email } })
      setLink({ email, url: `${window.location.origin}${result.path}` })
    } catch {
      toast.error('Nie udało się utworzyć linku.')
    }
  }

  async function makeTemp(email: string) {
    if (!window.confirm(`Ustawić dla ${email} nowe hasło tymczasowe? Obecne hasło przestanie działać, a konto zostanie wylogowane.`)) return
    try {
      const result = await setTemporaryPassword({ data: { email } })
      setTempPassword({ email, password: result.password })
      await load()
    } catch {
      toast.error('Nie udało się ustawić hasła.')
    }
  }

  function freeze(email: string) {
    const typed = window.prompt('Na ile godzin zamrozić konto? (1–720, 0 = zdjęcie zamrożenia)', '24')
    if (typed === null) return
    const hours = Number(typed)
    if (!Number.isInteger(hours) || hours < 0 || hours > 720) {
      toast.error('Podaj liczbę całkowitą od 0 do 720.')
      return
    }
    void run(() => freezeAccount({ data: { email, hours } }), hours ? 'Konto zamrożone.' : 'Zdjęto zamrożenie.')
  }

  if (failed) return <p role="alert" className="text-sm text-destructive">Nie udało się wczytać kont.</p>
  if (accounts === null) return <p className="text-muted-foreground">Wczytywanie…</p>

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Konta ({accounts.length})</h3>
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Unieważnić hasła wszystkich kont? Każdy będzie musiał ustawić nowe hasło, a wszyscy zostaną wylogowani (poza Tobą).')) {
                void run(() => invalidateAllPasswords(), 'Hasła unieważnione.')
              }
            }}
          >
            Unieważnij wszystkie hasła
          </Button>
        </div>
        <ul className="mt-2 divide-y rounded-md border text-sm">
          {accounts.map((account) => (
            <li key={account.id} className="space-y-1 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{account.email}</span>
                <span className="text-xs text-muted-foreground">{account.isOwner ? 'właściciel' : account.roles.join(', ')}</span>
                {account.locked && <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-700 ring-1 ring-red-200">zablokowane</span>}
                {account.frozenUntil && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800 ring-1 ring-amber-200">zamrożone ({remaining(account.frozenUntil)})</span>}
                {account.mustChangePassword && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700 ring-1 ring-blue-200">musi zmienić hasło</span>}
                {account.weakPassword && <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs text-orange-800 ring-1 ring-orange-300">słabe hasło</span>}
              </div>
              <p className="text-xs text-muted-foreground">
                Ostatnie logowanie: {account.lastLoginAt ? formatDateTime(account.lastLoginAt) : 'brak'}
                {account.lockedReason ? ` · ${account.lockedReason}` : ''}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Button variant="outline" size="sm" onClick={() => void showHistory(account.email)}>Historia logowań</Button>
                {!account.isOwner && (
                  <>
                    {account.locked ? (
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => setAccountLock({ data: { email: account.email, locked: false } }), 'Konto odblokowane.')}>Odblokuj</Button>
                    ) : (
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => {
                        const reason = window.prompt('Powód blokady (opcjonalnie):', '')
                        if (reason === null) return
                        void run(() => setAccountLock({ data: { email: account.email, locked: true, reason } }), 'Konto zablokowane i wylogowane.')
                      }}>Zablokuj</Button>
                    )}
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => freeze(account.email)}>Zamroź</Button>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => forcePasswordChange({ data: { email: account.email } }), 'Konto musi zmienić hasło.')}>Wymuś zmianę hasła</Button>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void makeLink(account.email)}>Link resetu hasła</Button>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void makeTemp(account.email)}>Hasło tymczasowe</Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <PermissionsMatrix />

      <div>
        <h3 className="text-sm font-semibold">Aktywne sesje ({sessions.length})</h3>
        {sessions.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Brak aktywnych sesji.</p>
        ) : (
          <ul className="mt-2 divide-y rounded-md border text-sm">
            {sessions.map((s) => (
              <li key={s.tokenHash} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div>
                  <p className="font-medium">{s.identity}</p>
                  <p className="text-xs text-muted-foreground">{browser(s.userAgent)} · {s.ip ?? 'adres nieznany'} · od {formatDateTime(s.createdAt)}</p>
                </div>
                <div className="flex gap-1.5">
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => signOutSession({ data: { tokenHash: s.tokenHash } }), 'Sesja zakończona.')}>Zakończ sesję</Button>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => {
                    if (window.confirm(`Wylogować konto ${s.identity} ze wszystkich urządzeń?`)) {
                      void run(() => signOutAccount({ data: { identity: s.identity } }), 'Konto wylogowane.')
                    }
                  }}>Wyloguj konto</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          „Zakończ sesję” kończy tylko tę przeglądarkę; osoba może zalogować się ponownie. Żeby ją całkiem odciąć, użyj „Wyloguj konto” albo „Zablokuj”.
        </p>
      </div>

      <Dialog open={history !== null} onOpenChange={(open) => !open && setHistory(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Historia: {history?.email}</DialogTitle>
            <DialogDescription>Ostatnie logowania, nieudane próby i alerty tego konta.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-[60vh] divide-y overflow-y-auto rounded-md border text-sm">
            {history?.rows.length === 0 && <li className="px-3 py-2 text-muted-foreground">Brak zdarzeń.</li>}
            {history?.rows.map((r) => (
              <li key={r.id} className="px-3 py-2">
                <p className="font-medium">{r.kind === 'login' ? 'Logowanie' : r.kind === 'login_failed' ? 'Nieudane logowanie' : r.kind}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(r.createdAt)} · {r.ip ?? 'brak adresu'}{r.country ? ` · ${countryLabel(r.country)}` : ''}
                </p>
                {r.details && <p className="text-xs text-muted-foreground">{r.details}</p>}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      <Dialog open={link !== null} onOpenChange={(open) => !open && setLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link do resetu hasła: {link?.email}</DialogTitle>
            <DialogDescription>
              Jednorazowy, ważny godzinę. Przekaż go właścicielowi konta (e-mail wyślemy tylko, jeśli skonfigurowano Resend). Link działa tylko raz.
            </DialogDescription>
          </DialogHeader>
          <input readOnly value={link?.url ?? ''} onFocus={(e) => e.currentTarget.select()} className="w-full rounded border bg-white px-2 py-1 font-mono text-xs" />
          <Button onClick={() => { void navigator.clipboard?.writeText(link?.url ?? ''); toast.success('Skopiowano.') }}>Kopiuj link</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={tempPassword !== null} onOpenChange={(open) => !open && setTempPassword(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hasło tymczasowe: {tempPassword?.email}</DialogTitle>
            <DialogDescription>
              Widoczne tylko teraz. Po zamknięciu okna nie da się go odczytać, bo hasła są zapisane wyłącznie jako nieodwracalny skrót. Konto musi zmienić hasło po pierwszym logowaniu.
            </DialogDescription>
          </DialogHeader>
          <input readOnly value={tempPassword?.password ?? ''} onFocus={(e) => e.currentTarget.select()} className="w-full rounded border bg-white px-2 py-1 font-mono text-sm" />
          <Button onClick={() => { void navigator.clipboard?.writeText(tempPassword?.password ?? ''); toast.success('Skopiowano.') }}>Kopiuj hasło</Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
