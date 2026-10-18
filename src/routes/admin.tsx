import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  acceptInvite,
  getUser,
  handleAuthCallback,
  login,
  logout,
  updateUser,
  type User,
} from '@netlify/identity'
import {
  LogOut,
  Pencil,
  ScrollText,
  Search,
  Trash2,
  UserCog,
  UserPlus,
  Users,
} from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AUDIT_ACTION_LABELS,
  MANAGEMENT_COOLDOWN_SECONDS,
  PESEL_MAX_LENGTH,
  PROFESSIONS,
  ROLE_ADMIN,
  ROLE_MANAGEMENT,
  isParamedic,
  isPesel,
  isPwz,
  pwzFromPesel,
} from '@/lib/registry'
import {
  addManagement,
  addPractitioner,
  deleteManagement,
  deletePractitioner,
  getCooldown,
  listAuditLog,
  listManagement,
  listPractitioners,
  updatePractitioner,
} from '@/lib/registry.functions'

export const Route = createFileRoute('/admin')({
  head: () => ({
    meta: [
      { title: 'Panel administratora – Centralny Rejestr' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
  component: AdminPage,
})

type Auth =
  | { phase: 'loading' }
  | { phase: 'signed-out' }
  | { phase: 'invite'; token: string }
  | { phase: 'recovery' }
  | { phase: 'signed-in'; user: User }

function AdminPage() {
  const [auth, setAuth] = useState<Auth>({ phase: 'loading' })

  useEffect(() => {
    let active = true
    async function init() {
      try {
        const callback = await handleAuthCallback()
        if (callback?.type === 'invite' && callback.token) {
          if (active) setAuth({ phase: 'invite', token: callback.token })
          return
        }
        if (callback?.type === 'recovery') {
          if (active) setAuth({ phase: 'recovery' })
          return
        }
      } catch {
        toast.error('Link z wiadomości e-mail jest nieprawidłowy lub wygasł.')
      }
      const user = await getUser().catch(() => null)
      if (active) {
        setAuth(user ? { phase: 'signed-in', user } : { phase: 'signed-out' })
      }
    }
    void init()
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="mx-auto max-w-[1062px] px-5 py-12">
      <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-[var(--registry-navy)]">
        Panel administratora
      </h1>
      <div className="mt-8">
        {auth.phase === 'loading' && (
          <p className="text-muted-foreground">Wczytywanie…</p>
        )}
        {auth.phase === 'signed-out' && (
          <LoginForm onDone={(user) => setAuth({ phase: 'signed-in', user })} />
        )}
        {auth.phase === 'invite' && (
          <PasswordForm
            title="Ustaw hasło do konta administratora"
            onSubmit={(password) => acceptInvite(auth.token, password)}
            onDone={(user) => setAuth({ phase: 'signed-in', user })}
          />
        )}
        {auth.phase === 'recovery' && (
          <PasswordForm
            title="Ustaw nowe hasło"
            onSubmit={(password) => updateUser({ password })}
            onDone={(user) => setAuth({ phase: 'signed-in', user })}
          />
        )}
        {auth.phase === 'signed-in' && (
          <SignedIn
            user={auth.user}
            onLogout={async () => {
              await logout().catch(() => undefined)
              setAuth({ phase: 'signed-out' })
            }}
          />
        )}
      </div>
    </div>
  )
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm">{children}</div>
  )
}

function LoginForm({ onDone }: { onDone: (user: User) => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    setPending(true)
    setError(false)
    try {
      const user = await login(
        String(fields.get('email')),
        String(fields.get('password')),
      )
      onDone(user)
    } catch {
      setError(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="max-w-md">
      <Panel>
        <h2 className="text-lg font-semibold">Logowanie</h2>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Hasło</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              Nieprawidłowy e-mail lub hasło.
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Logowanie…' : 'Zaloguj się'}
          </Button>
        </form>
      </Panel>
    </div>
  )
}

function PasswordForm({
  title,
  onSubmit,
  onDone,
}: {
  title: string
  onSubmit: (password: string) => Promise<User>
  onDone: (user: User) => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const password = String(new FormData(event.currentTarget).get('password'))
    if (password.length < 8) {
      setError('Hasło musi mieć co najmniej 8 znaków.')
      return
    }
    setPending(true)
    setError(null)
    try {
      onDone(await onSubmit(password))
      toast.success('Hasło zostało ustawione.')
    } catch {
      setError('Nie udało się ustawić hasła. Link mógł wygasnąć.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="max-w-md">
      <Panel>
        <h2 className="text-lg font-semibold">{title}</h2>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password">Hasło</Label>
            <Input
              id="new-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Zapisywanie…' : 'Zapisz hasło'}
          </Button>
        </form>
      </Panel>
    </div>
  )
}

type Row = Awaited<ReturnType<typeof listPractitioners>>[number]

/** Lowercase and strip Polish diacritics so "zolw" finds "Żółw". */
function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/gi, 'l')
    .toLowerCase()
}

/** Every word of the query must appear somewhere in the row (any order). */
function matchesQuery(row: Row, query: string) {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = normalize(
    [
      row.firstName,
      row.lastName,
      row.pwz,
      row.profession,
      row.specialization,
      row.pesel, // null for kierownictwo, so they cannot search by PESEL
    ]
      .filter(Boolean)
      .join(' '),
  )
  return words.every((word) => haystack.includes(word))
}

function SignedIn({ user, onLogout }: { user: User; onLogout: () => void }) {
  const isAdmin = user.roles?.includes(ROLE_ADMIN) ?? false
  const isManagement = user.roles?.includes(ROLE_MANAGEMENT) ?? false
  const canAdd = isAdmin || isManagement
  const [rows, setRows] = useState<Row[] | null>(null)
  const [editing, setEditing] = useState<Row | null>(null)
  const [managementOpen, setManagementOpen] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [showManagement, setShowManagement] = useState(false)
  const [query, setQuery] = useState('')
  // Bumped after every change so an open audit log reloads itself.
  const [logVersion, setLogVersion] = useState(0)

  const refresh = useCallback(async () => {
    try {
      setRows(await listPractitioners())
    } catch {
      toast.error('Nie udało się wczytać rejestru.')
      setRows([])
    }
  }, [])

  const refreshAll = useCallback(async () => {
    await refresh()
    setLogVersion((version) => version + 1)
  }, [refresh])

  useEffect(() => {
    if (canAdd) void refresh()
  }, [canAdd, refresh])

  const visible = rows ? rows.filter((row) => matchesQuery(row, query)) : []

  async function remove(row: Row) {
    if (!confirm(`Usunąć ${row.firstName} ${row.lastName} z rejestru?`)) return
    try {
      await deletePractitioner({ data: { id: row.id } })
      toast.success('Wpis usunięty.')
      await refreshAll()
    } catch {
      toast.error('Nie udało się usunąć wpisu.')
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Zalogowano jako <strong className="text-foreground">{user.email}</strong>
        </p>
        <Button variant="outline" size="sm" onClick={onLogout}>
          <LogOut className="size-4" /> Wyloguj
        </Button>
      </div>

      {isAdmin && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setManagementOpen(true)}>
            <UserCog className="size-4" /> Dodaj kierownictwo
          </Button>
          <Button
            variant={showManagement ? 'default' : 'outline'}
            onClick={() => setShowManagement((open) => !open)}
          >
            <Users className="size-4" /> Konta kierownictwa
          </Button>
          <Button
            variant={showLog ? 'default' : 'outline'}
            onClick={() => setShowLog((open) => !open)}
          >
            <ScrollText className="size-4" /> Dziennik zdarzeń
          </Button>
        </div>
      )}
      {isAdmin && showManagement && (
        <ManagementPanel
          key={logVersion}
          onChanged={() => setLogVersion((version) => version + 1)}
        />
      )}
      {isAdmin && showLog && <AuditLogPanel key={logVersion} />}
      {isAdmin && (
        <ManagementDialog
          open={managementOpen}
          onClose={() => setManagementOpen(false)}
          onCreated={() => setLogVersion((version) => version + 1)}
        />
      )}

      {!canAdd ? (
        <Panel>
          <p>
            To konto nie ma uprawnień do panelu. Nadaj mu rolę{' '}
            <code className="rounded bg-muted px-1">{ROLE_ADMIN}</code> lub{' '}
            <code className="rounded bg-muted px-1">{ROLE_MANAGEMENT}</code> w
            ustawieniach Netlify Identity, a następnie zaloguj się ponownie.
          </p>
        </Panel>
      ) : (
        <>
          <AddForm onAdded={refreshAll} limited={!isAdmin} />
          <Panel>
            <h2 className="text-lg font-semibold">
              Osoby w rejestrze
              {rows
                ? query.trim()
                  ? ` (${visible.length} z ${rows.length})`
                  : ` (${rows.length})`
                : ''}
            </h2>
            {rows && rows.length > 0 && (
              <div className="relative mt-4">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={
                    isAdmin
                      ? 'Szukaj pracownika: imię, nazwisko, PESEL, PWZ, zawód, specjalizacja…'
                      : 'Szukaj pracownika: imię, nazwisko, PWZ, zawód, specjalizacja…'
                  }
                  aria-label="Szukaj pracownika"
                  className="pl-9"
                />
              </div>
            )}
            {rows === null ? (
              <p className="mt-4 text-muted-foreground">Wczytywanie…</p>
            ) : rows.length === 0 ? (
              <p className="mt-4 text-muted-foreground">
                Rejestr jest pusty. Dodaj pierwszą osobę powyżej.
              </p>
            ) : (
              <div className="mt-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Imię i nazwisko</TableHead>
                      {isAdmin && <TableHead>PESEL</TableHead>}
                      <TableHead>PWZ</TableHead>
                      <TableHead>Zawód</TableHead>
                      <TableHead>Specjalizacja</TableHead>
                      {isAdmin && <TableHead className="w-24" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">
                          {row.firstName} {row.lastName}
                        </TableCell>
                        {isAdmin && (
                          <TableCell className="font-mono">{row.pesel}</TableCell>
                        )}
                        <TableCell className="font-mono">{row.pwz}</TableCell>
                        <TableCell>{row.profession}</TableCell>
                        <TableCell>{row.specialization}</TableCell>
                        {isAdmin && (
                          <TableCell className="whitespace-nowrap">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Edytuj ${row.firstName} ${row.lastName}`}
                              onClick={() => setEditing(row)}
                            >
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Usuń ${row.firstName} ${row.lastName}`}
                              onClick={() => remove(row)}
                            >
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {visible.length === 0 && (
                  <p className="mt-4 text-center text-muted-foreground">
                    Brak osób pasujących do „{query.trim()}”.
                  </p>
                )}
              </div>
            )}
          </Panel>
          {isAdmin && (
            <EditDialog
              row={editing}
              onClose={() => setEditing(null)}
              onSaved={refreshAll}
            />
          )}
        </>
      )}
    </div>
  )
}

type ManagementRow = Awaited<ReturnType<typeof listManagement>>[number]

function ManagementPanel({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<ManagementRow[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setRows(await listManagement())
    } catch {
      setFailed(true)
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function remove(row: ManagementRow) {
    if (
      !confirm(
        `Usunąć konto kierownictwa ${row.email}? Ta osoba nie będzie mogła się już zalogować.`,
      )
    ) {
      return
    }
    try {
      const result = await deleteManagement({ data: { id: row.id } })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Konto kierownictwa usunięte.')
      onChanged() // remounts this panel, which reloads the list
    } catch {
      toast.error('Nie udało się usunąć konta.')
    }
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Users className="size-5" /> Konta kierownictwa
          {rows && !failed ? ` (${rows.length})` : ''}
        </h2>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Odśwież
        </Button>
      </div>
      {rows === null ? (
        <p className="mt-4 text-muted-foreground">Wczytywanie…</p>
      ) : failed ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          Nie udało się wczytać kont kierownictwa.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-muted-foreground">
          Brak kont kierownictwa. Dodaj pierwsze przyciskiem „Dodaj
          kierownictwo”.
        </p>
      ) : (
        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>E-mail</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.email}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Usuń konto kierownictwa ${row.email}`}
                      onClick={() => void remove(row)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  )
}

type AuditRow = Awaited<ReturnType<typeof listAuditLog>>[number]

function formatTime(iso: string) {
  return new Date(iso).toLocaleString('pl-PL', {
    timeZone: 'Europe/Warsaw',
    dateStyle: 'short',
    timeStyle: 'medium',
  })
}

function AuditLogPanel() {
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setRows(await listAuditLog())
    } catch {
      setFailed(true)
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ScrollText className="size-5" /> Dziennik zdarzeń
        </h2>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Odśwież
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Kto, co i kiedy zrobił (ostatnie 300 zdarzeń, najnowsze na górze).
      </p>
      {rows === null ? (
        <p className="mt-4 text-muted-foreground">Wczytywanie…</p>
      ) : failed ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          Nie udało się wczytać dziennika zdarzeń.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-muted-foreground">Brak zapisanych zdarzeń.</p>
      ) : (
        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kiedy</TableHead>
                <TableHead>Kto</TableHead>
                <TableHead>Akcja</TableHead>
                <TableHead>Dotyczy</TableHead>
                <TableHead>Szczegóły</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatTime(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    {row.actor}
                    <span className="block text-xs text-muted-foreground">
                      {row.actorRole}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {AUDIT_ACTION_LABELS[
                      row.action as keyof typeof AUDIT_ACTION_LABELS
                    ] ?? row.action}
                  </TableCell>
                  <TableCell>{row.target}</TableCell>
                  <TableCell className="whitespace-normal">{row.details}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  )
}

function ManagementDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) setError(null)
  }, [open])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    setPending(true)
    setError(null)
    try {
      const result = await addManagement({
        data: {
          email: String(fields.get('email')),
          password: String(fields.get('password')),
        },
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success(`Dodano konto kierownictwa: ${result.email}`)
      form.reset()
      onCreated()
      onClose()
    } catch {
      setError('Nie udało się utworzyć konta.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dodaj konto kierownictwa</DialogTitle>
          <DialogDescription>
            Tworzy konto z rolą kierownictwo: dodaje osoby do rejestru (jedną na
            5 minut), nie może ich usuwać ani edytować. Przekaż osobie e-mail i
            hasło początkowe.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mgmt-email">E-mail</Label>
            <Input
              id="mgmt-email"
              name="email"
              type="email"
              autoComplete="off"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mgmt-password">Hasło początkowe</Label>
            <Input
              id="mgmt-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />
            <p className="text-xs text-muted-foreground">Co najmniej 8 znaków.</p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Anuluj
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Tworzenie…' : 'Utwórz konto'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditDialog({
  row,
  onClose,
  onSaved,
}: {
  row: Row | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [pesel, setPesel] = useState('')
  const [pwz, setPwz] = useState('')
  const [specialization, setSpecialization] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const paramedic = row ? isParamedic(row.profession) : false

  // Reset the form whenever a different entry is opened.
  useEffect(() => {
    setPesel(row?.pesel ?? '')
    setPwz(row?.pwz ?? '')
    setSpecialization(row?.rawSpecialization ?? '')
    setError(null)
  }, [row])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!row) return
    if (!isPesel(pesel)) {
      setError('PESEL musi składać się z samych cyfr (co najmniej jednej).')
      return
    }
    if (!isPwz(pwz)) {
      setError('Numer PWZ musi składać się z 7 cyfr.')
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await updatePractitioner({
        data: {
          id: row.id,
          pesel,
          pwz,
          specialization: paramedic ? undefined : specialization,
        },
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success('Zapisano zmiany.')
      onClose()
      await onSaved()
    } catch {
      setError('Nie udało się zapisać zmian.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Edytuj wpis: {row?.firstName} {row?.lastName}
          </DialogTitle>
          <DialogDescription>
            Możesz zmienić numer PESEL, specjalizację oraz ręcznie ustawić numer
            PWZ.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-pesel">PESEL</Label>
            <Input
              id="edit-pesel"
              inputMode="numeric"
              value={pesel}
              onChange={(e) =>
                setPesel(e.target.value.replace(/\D/g, '').slice(0, PESEL_MAX_LENGTH))
              }
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-pwz">Numer PWZ</Label>
            <Input
              id="edit-pwz"
              inputMode="numeric"
              value={pwz}
              onChange={(e) => setPwz(e.target.value.replace(/\D/g, '').slice(0, 7))}
              required
            />
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:no-underline disabled:opacity-50"
              disabled={!isPesel(pesel)}
              onClick={() => setPwz(pwzFromPesel(pesel))}
            >
              Wylicz z PESEL
              {isPesel(pesel) ? ` (${pwzFromPesel(pesel)})` : ''}
            </button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-specialization">Specjalizacja</Label>
            {paramedic ? (
              <Input id="edit-specialization" value="nd." disabled />
            ) : (
              <Input
                id="edit-specialization"
                value={specialization}
                onChange={(e) => setSpecialization(e.target.value)}
                placeholder="np. chirurgia ogólna"
                maxLength={160}
              />
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Anuluj
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Zapisywanie…' : 'Zapisz zmiany'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

function formatWait(seconds: number) {
  const m = Math.floor(seconds / 60)
  const sec = String(seconds % 60).padStart(2, '0')
  return `${m}:${sec}`
}

function AddForm({
  onAdded,
  limited,
}: {
  onAdded: () => Promise<void>
  /** Management accounts: one entry per MANAGEMENT_COOLDOWN_SECONDS. */
  limited: boolean
}) {
  const [secondsLeft, setSecondsLeft] = useState(0)

  useEffect(() => {
    if (!limited) return
    let active = true
    getCooldown()
      .then((r) => {
        if (active) setSecondsLeft(r.secondsLeft)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [limited])

  const waiting = secondsLeft > 0

  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(
      () => setSecondsLeft((s) => (s > 0 ? s - 1 : 0)),
      1000,
    )
    return () => clearInterval(timer)
  }, [waiting])

  const [pesel, setPesel] = useState('')
  const [profession, setProfession] = useState<string>(PROFESSIONS[0])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const paramedic = isParamedic(profession)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    if (waiting) return
    if (!isPesel(pesel)) {
      setError('PESEL musi składać się z samych cyfr (co najmniej jednej).')
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await addPractitioner({
        data: {
          pesel,
          firstName: String(fields.get('firstName')),
          lastName: String(fields.get('lastName')),
          profession: profession as (typeof PROFESSIONS)[number],
          specialization: paramedic
            ? undefined
            : String(fields.get('specialization') ?? ''),
        },
      })
      if (!result.ok) {
        setError(result.error)
        if (result.secondsLeft) setSecondsLeft(result.secondsLeft)
        return
      }
      if (limited) setSecondsLeft(MANAGEMENT_COOLDOWN_SECONDS)
      toast.success(`Dodano do rejestru. Numer PWZ: ${result.pwz}`)
      form.reset()
      setPesel('')
      await onAdded()
    } catch {
      setError('Nie udało się zapisać wpisu.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Panel>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <UserPlus className="size-5" /> Dodaj osobę
      </h2>
      <form onSubmit={submit} className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">Imię</Label>
          <Input id="firstName" name="firstName" required maxLength={80} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Nazwisko</Label>
          <Input id="lastName" name="lastName" required maxLength={80} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pesel">PESEL</Label>
          <Input
            id="pesel"
            name="pesel"
            inputMode="numeric"
            value={pesel}
            onChange={(e) => setPesel(
                e.target.value.replace(/\D/g, '').slice(0, PESEL_MAX_LENGTH),
              )}
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
          <Label htmlFor="profession">Zawód</Label>
          <select
            id="profession"
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
          <Label htmlFor="specialization">Specjalizacja (opcjonalnie)</Label>
          {paramedic ? (
            <Input id="specialization" value="nd." disabled />
          ) : (
            <Input
              id="specialization"
              name="specialization"
              placeholder="np. chirurgia ogólna"
              maxLength={160}
            />
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
              ? 'Zapisywanie…'
              : waiting
                ? `Kolejną osobę możesz dodać za ${formatWait(secondsLeft)}`
                : 'Dodaj do rejestru'}
          </Button>
          {limited && !waiting && (
            <p className="mt-2 text-xs text-muted-foreground">
              Konto kierownictwa może dodać jedną osobę na 5 minut i nie może
              usuwać wpisów.
            </p>
          )}
        </div>
      </form>
    </Panel>
  )
}
