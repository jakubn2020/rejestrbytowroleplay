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
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  Inbox,
  KeyRound,
  LogOut,
  Pencil,
  ScrollText,
  Search,
  Stamp,
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
  ENTRY_STATUSES,
  ENTRY_STATUS_KEYS,
  PESEL_MAX_LENGTH,
  PROFESSIONS,
  ROLE_ADMIN,
  ROLE_MANAGEMENT,
  TRASH_RETENTION_DAYS,
  formatDate,
  isParamedic,
  isPesel,
  isPwz,
  pwzFromPesel,
  type EntryStatus,
} from '@/lib/registry'
import {
  addManagement,
  addPractitioner,
  deleteManagement,
  deletePractitioner,
  listManagement,
  listPractitioners,
  updatePractitioner,
} from '@/lib/registry.functions'

import { AuditLogPanel } from '@/components/admin/audit-log-panel'
import { MfaForm } from '@/components/admin/mfa-form'
import { Panel } from '@/components/admin/panel'
import {
  ChangePasswordDialog,
  ResetManagementPasswordDialog,
} from '@/components/admin/password-dialogs'
import { RequestForm } from '@/components/admin/request-form'
import {
  MyRequestsPanel,
  RequestsPanel,
} from '@/components/admin/requests-panels'
import { SealDialog } from '@/components/admin/seal-dialog'
import { TrashPanel } from '@/components/admin/trash-panel'
import { endMfaSession, getMfaStatus } from '@/lib/mfa.functions'
import { countPendingRequests } from '@/lib/requests.functions'

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
  | { phase: 'mfa'; user: User }
  | { phase: 'signed-in'; user: User }

/** Where a freshly authenticated user goes next: the e-mail code step (if enabled) or the panel. */
async function resolveAuth(user: User): Promise<Auth> {
  // If the status cannot be read, fail closed and ask for the code.
  const status = await getMfaStatus().catch(() => ({
    required: true,
    verified: false,
  }))
  return status.required && !status.verified
    ? { phase: 'mfa', user }
    : { phase: 'signed-in', user }
}

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
      const next: Auth = user ? await resolveAuth(user) : { phase: 'signed-out' }
      if (active) setAuth(next)
    }
    void init()
    return () => {
      active = false
    }
  }, [])

  async function enter(user: User) {
    setAuth(await resolveAuth(user))
  }

  async function signOut() {
    await endMfaSession().catch(() => undefined)
    await logout().catch(() => undefined)
    setAuth({ phase: 'signed-out' })
  }

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
          <LoginForm onDone={(user) => void enter(user)} />
        )}
        {auth.phase === 'invite' && (
          <PasswordForm
            title="Ustaw hasło do konta administratora"
            onSubmit={(password) => acceptInvite(auth.token, password)}
            onDone={(user) => void enter(user)}
          />
        )}
        {auth.phase === 'recovery' && (
          <PasswordForm
            title="Ustaw nowe hasło"
            onSubmit={(password) => updateUser({ password })}
            onDone={(user) => void enter(user)}
          />
        )}
        {auth.phase === 'mfa' && (
          <MfaForm
            user={auth.user}
            onVerified={() => setAuth({ phase: 'signed-in', user: auth.user })}
            onLogout={() => void signOut()}
          />
        )}
        {auth.phase === 'signed-in' && (
          <SignedIn user={auth.user} onLogout={() => void signOut()} />
        )}
      </div>
    </div>
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
    .replace(/[̀-ͯ]/g, '')
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
      ENTRY_STATUSES[row.status],
      row.entryNumber,
      row.createdBy,
      row.pesel,
    ]
      .filter(Boolean)
      .join(' '),
  )
  return words.every((word) => haystack.includes(word))
}

type SortKey = 'name' | 'pwz' | 'profession' | 'status' | 'date'
type Sort = { key: SortKey; dir: 'asc' | 'desc' }

const STATUS_STYLES: Record<EntryStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  suspended: 'bg-amber-50 text-amber-800 ring-amber-200',
  expired: 'bg-red-50 text-red-700 ring-red-200',
}

function StatusBadge({ status }: { status: EntryStatus }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ring-1 ${STATUS_STYLES[status]}`}
    >
      {ENTRY_STATUSES[status]}
    </span>
  )
}

function compareRows(a: Row, b: Row, { key, dir }: Sort) {
  let result: number
  switch (key) {
    case 'name':
      result = `${a.lastName} ${a.firstName}`.localeCompare(
        `${b.lastName} ${b.firstName}`,
        'pl',
      )
      break
    case 'pwz':
      result = a.pwz.localeCompare(b.pwz)
      break
    case 'profession':
      result = a.profession.localeCompare(b.profession, 'pl')
      break
    case 'status':
      result = a.status.localeCompare(b.status)
      break
    default:
      result = a.entryDate.localeCompare(b.entryDate)
  }
  return dir === 'asc' ? result : -result
}

function SortHead({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string
  sortKey: SortKey
  sort: Sort
  onSort: (key: SortKey) => void
}) {
  const active = sort.key === sortKey
  return (
    <TableHead
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 hover:underline"
      >
        {label}
        {active &&
          (sort.dir === 'asc' ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          ))}
      </button>
    </TableHead>
  )
}

function SignedIn({ user, onLogout }: { user: User; onLogout: () => void }) {
  const isAdmin = user.roles?.includes(ROLE_ADMIN) ?? false
  const isManagement = user.roles?.includes(ROLE_MANAGEMENT) ?? false
  const canAdd = isAdmin || isManagement
  const [rows, setRows] = useState<Row[] | null>(null)
  const [editing, setEditing] = useState<Row | null>(null)
  const [managementOpen, setManagementOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [sealOpen, setSealOpen] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [showManagement, setShowManagement] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const [showRequests, setShowRequests] = useState(false)
  const [pendingRequests, setPendingRequests] = useState(0)
  const [query, setQuery] = useState('')
  const [professionFilter, setProfessionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [authorFilter, setAuthorFilter] = useState('')
  const [sort, setSort] = useState<Sort>({ key: 'date', dir: 'desc' })
  // Bumped after every change so open panels (log, trash, accounts) reload themselves.
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

  // Number of requests waiting for an admin decision (shown on the "Wnioski" button).
  useEffect(() => {
    if (!isAdmin) return
    let active = true
    countPendingRequests()
      .then((r) => {
        if (active) setPendingRequests(r.pending)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [isAdmin, logVersion])

  const professions = rows
    ? [...new Set(rows.map((r) => r.profession))].sort((a, b) =>
        a.localeCompare(b, 'pl'),
      )
    : []
  const authors = rows
    ? [...new Set(rows.flatMap((r) => (r.createdBy ? [r.createdBy] : [])))].sort()
    : []
  const filtering = Boolean(
    query.trim() || professionFilter || statusFilter || authorFilter,
  )
  const visible = rows
    ? rows
        .filter(
          (row) =>
            matchesQuery(row, query) &&
            (!professionFilter || row.profession === professionFilter) &&
            (!statusFilter || row.status === statusFilter) &&
            (!authorFilter || row.createdBy === authorFilter),
        )
        .sort((a, b) => compareRows(a, b, sort))
    : []

  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'date' ? 'desc' : 'asc' },
    )
  }

  async function remove(row: Row) {
    if (
      !confirm(
        `Usunąć ${row.firstName} ${row.lastName} z rejestru? Wpis trafi do kosza i można go przywrócić przez ${TRASH_RETENTION_DAYS} dni.`,
      )
    ) {
      return
    }
    try {
      await deletePractitioner({ data: { id: row.id } })
      toast.success('Wpis przeniesiony do kosza.')
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
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setPasswordOpen(true)}>
            <KeyRound className="size-4" /> Zmień hasło
          </Button>
          <Button variant="outline" size="sm" onClick={onLogout}>
            <LogOut className="size-4" /> Wyloguj
          </Button>
        </div>
      </div>
      <ChangePasswordDialog
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
      />

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
            variant={showRequests ? 'default' : 'outline'}
            onClick={() => setShowRequests((open) => !open)}
          >
            <Inbox className="size-4" /> Wnioski
            {pendingRequests > 0 ? ` (${pendingRequests})` : ''}
          </Button>
          <Button
            variant={showTrash ? 'default' : 'outline'}
            onClick={() => setShowTrash((open) => !open)}
          >
            <Trash2 className="size-4" /> Kosz
          </Button>
          <Button
            variant={showLog ? 'default' : 'outline'}
            onClick={() => setShowLog((open) => !open)}
          >
            <ScrollText className="size-4" /> Dziennik zdarzeń
          </Button>
          <Button variant="outline" onClick={() => setSealOpen(true)}>
            <Stamp className="size-4" /> Pieczęć
          </Button>
        </div>
      )}
      {isAdmin && showManagement && (
        <ManagementPanel
          key={logVersion}
          onChanged={() => setLogVersion((version) => version + 1)}
        />
      )}
      {isAdmin && showRequests && (
        <RequestsPanel key={logVersion} onChanged={() => void refreshAll()} />
      )}
      {isAdmin && showTrash && (
        <TrashPanel key={logVersion} onChanged={() => void refreshAll()} />
      )}
      {isAdmin && showLog && <AuditLogPanel key={logVersion} />}
      {isAdmin && (
        <>
          <ManagementDialog
            open={managementOpen}
            onClose={() => setManagementOpen(false)}
            onCreated={() => setLogVersion((version) => version + 1)}
          />
          <SealDialog open={sealOpen} onClose={() => setSealOpen(false)} />
        </>
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
          {isAdmin ? (
            <AddForm onAdded={refreshAll} />
          ) : (
            <>
              <RequestForm
                onSubmitted={() => setLogVersion((version) => version + 1)}
              />
              <MyRequestsPanel key={logVersion} />
            </>
          )}
          <Panel>
            <h2 className="text-lg font-semibold">
              Osoby w rejestrze
              {rows
                ? filtering
                  ? ` (${visible.length} z ${rows.length})`
                  : ` (${rows.length})`
                : ''}
            </h2>
            {rows && rows.length > 0 && (
              <div className="mt-4 space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Szukaj pracownika: imię, nazwisko, PESEL, PWZ, zawód, specjalizacja…"
                    aria-label="Szukaj pracownika"
                    className="pl-9"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    value={professionFilter}
                    onChange={(e) => setProfessionFilter(e.target.value)}
                    className={filterSelectClass}
                    aria-label="Filtruj po zawodzie"
                  >
                    <option value="">Wszystkie zawody</option>
                    {professions.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className={filterSelectClass}
                    aria-label="Filtruj po statusie"
                  >
                    <option value="">Wszystkie statusy</option>
                    {ENTRY_STATUS_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {ENTRY_STATUSES[k]}
                      </option>
                    ))}
                  </select>
                  <select
                    value={authorFilter}
                    onChange={(e) => setAuthorFilter(e.target.value)}
                    className={filterSelectClass}
                    aria-label="Filtruj po osobie, która dodała wpis"
                  >
                    <option value="">Dodane przez: wszyscy</option>
                    {authors.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant={sort.key === 'date' ? 'default' : 'outline'}
                    size="sm"
                    className="h-9"
                    onClick={() => toggleSort('date')}
                  >
                    Data wpisu
                    {sort.key === 'date' &&
                      (sort.dir === 'asc' ? (
                        <ArrowUp className="size-3" />
                      ) : (
                        <ArrowDown className="size-3" />
                      ))}
                  </Button>
                  {filtering && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9"
                      onClick={() => {
                        setQuery('')
                        setProfessionFilter('')
                        setStatusFilter('')
                        setAuthorFilter('')
                      }}
                    >
                      Wyczyść filtry
                    </Button>
                  )}
                </div>
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
                      <SortHead label="Imię i nazwisko" sortKey="name" sort={sort} onSort={toggleSort} />
                      <TableHead>PESEL</TableHead>
                      <SortHead label="PWZ" sortKey="pwz" sort={sort} onSort={toggleSort} />
                      <SortHead label="Zawód" sortKey="profession" sort={sort} onSort={toggleSort} />
                      <TableHead>Specjalizacja</TableHead>
                      <SortHead label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                      <TableHead className={isAdmin ? 'w-32' : 'w-14'} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">
                          {row.firstName} {row.lastName}
                          <span className="block text-xs font-normal text-muted-foreground">
                            Nr {row.entryNumber} · {formatDate(row.entryDate)}
                            {row.createdBy ? ` · dodał(a): ${row.createdBy}` : ''}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono">{row.pesel}</TableCell>
                        <TableCell className="font-mono">{row.pwz}</TableCell>
                        <TableCell>{row.profession}</TableCell>
                        <TableCell>{row.specialization}</TableCell>
                        <TableCell>
                          <StatusBadge status={row.status} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Button
                            asChild
                            variant="ghost"
                            size="icon"
                            title="Plakietka"
                          >
                            <a
                              href={`/plakietka/${row.id}`}
                              target="_blank"
                              rel="noopener"
                              aria-label={`Plakietka: ${row.firstName} ${row.lastName}`}
                            >
                              <BadgeCheck className="size-4" />
                            </a>
                          </Button>
                          {isAdmin && (
                            <>
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
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {visible.length === 0 && (
                  <p className="mt-4 text-center text-muted-foreground">
                    Brak osób pasujących do wybranych kryteriów.
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

const filterSelectClass =
  'h-9 rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

type ManagementRow = Awaited<ReturnType<typeof listManagement>>[number]

function ManagementPanel({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<ManagementRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [resetTarget, setResetTarget] = useState<ManagementRow | null>(null)

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
      <ResetManagementPasswordDialog
        target={resetTarget}
        onClose={() => setResetTarget(null)}
        onDone={onChanged}
      />
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
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.email}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Ustaw nowe hasło dla ${row.email}`}
                      onClick={() => setResetTarget(row)}
                    >
                      <KeyRound className="size-4" />
                    </Button>
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
            Tworzy konto z rolą kierownictwo: składa wnioski o wpis (jeden na 5
            minut, ze zrzutem ekranu; akceptuje je administrator), widzi PESEL
            i tworzy plakietki, ale nie edytuje ani nie usuwa wpisów. Przekaż
            osobie e-mail i hasło początkowe.
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
  const [status, setStatus] = useState<EntryStatus>('active')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const paramedic = row ? isParamedic(row.profession) : false

  // Reset the form whenever a different entry is opened.
  useEffect(() => {
    setPesel(row?.pesel ?? '')
    setPwz(row?.pwz ?? '')
    setSpecialization(row?.rawSpecialization ?? '')
    setStatus(row?.status ?? 'active')
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
          status,
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
            Możesz zmienić numer PESEL, specjalizację i status wpisu oraz ręcznie
            ustawić numer PWZ. Zawieszony lub nieaktywny wpis nie ma zaświadczenia, a
            kod QR na plakietce pokaże „NIE”.
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
          <div className="space-y-2">
            <Label htmlFor="edit-status">Status wpisu</Label>
            <select
              id="edit-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as EntryStatus)}
              className={selectClass}
            >
              {ENTRY_STATUS_KEYS.map((k) => (
                <option key={k} value={k}>
                  {ENTRY_STATUSES[k]}
                </option>
              ))}
            </select>
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

/** Admin only: adds a person directly (kierownictwo uses RequestForm instead). */
function AddForm({ onAdded }: { onAdded: () => Promise<void> }) {
  const [pesel, setPesel] = useState('')
  const [profession, setProfession] = useState<string>(PROFESSIONS[0])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const paramedic = isParamedic(profession)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
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
        return
      }
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
          <Button type="submit" disabled={pending}>
            {pending ? 'Zapisywanie…' : 'Dodaj do rejestru'}
          </Button>
        </div>
      </form>
    </Panel>
  )
}
