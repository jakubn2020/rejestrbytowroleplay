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
import { LogOut, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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
import { PARAMEDIC, PROFESSIONS, isPesel, pwzFromPesel } from '@/lib/registry'
import {
  addPractitioner,
  deletePractitioner,
  listPractitioners,
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
    <div className="mx-auto max-w-5xl px-5 py-12">
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

function SignedIn({ user, onLogout }: { user: User; onLogout: () => void }) {
  const isAdmin = user.roles?.includes('admin') ?? false
  const [rows, setRows] = useState<Row[] | null>(null)

  const refresh = useCallback(async () => {
    try {
      setRows(await listPractitioners())
    } catch {
      toast.error('Nie udało się wczytać rejestru.')
      setRows([])
    }
  }, [])

  useEffect(() => {
    if (isAdmin) void refresh()
  }, [isAdmin, refresh])

  async function remove(row: Row) {
    if (!confirm(`Usunąć ${row.firstName} ${row.lastName} z rejestru?`)) return
    try {
      await deletePractitioner({ data: { id: row.id } })
      toast.success('Wpis usunięty.')
      await refresh()
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

      {!isAdmin ? (
        <Panel>
          <p>
            To konto nie ma uprawnień administratora. Nadaj mu rolę{' '}
            <code className="rounded bg-muted px-1">admin</code> w ustawieniach
            Netlify Identity, a następnie zaloguj się ponownie.
          </p>
        </Panel>
      ) : (
        <>
          <AddForm onAdded={refresh} />
          <Panel>
            <h2 className="text-lg font-semibold">
              Osoby w rejestrze{rows ? ` (${rows.length})` : ''}
            </h2>
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
                      <TableHead>PESEL</TableHead>
                      <TableHead>PWZ</TableHead>
                      <TableHead>Zawód</TableHead>
                      <TableHead>Specjalizacja</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">
                          {row.firstName} {row.lastName}
                        </TableCell>
                        <TableCell className="font-mono">{row.pesel}</TableCell>
                        <TableCell className="font-mono">{row.pwz}</TableCell>
                        <TableCell>{row.profession}</TableCell>
                        <TableCell>{row.specialization}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Usuń ${row.firstName} ${row.lastName}`}
                            onClick={() => remove(row)}
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
        </>
      )}
    </div>
  )
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

function AddForm({ onAdded }: { onAdded: () => Promise<void> }) {
  const [pesel, setPesel] = useState('')
  const [profession, setProfession] = useState<string>(PROFESSIONS[0])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isParamedic = profession === PARAMEDIC

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    if (!isPesel(pesel)) {
      setError('PESEL musi składać się z 11 cyfr.')
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
          specialization: isParamedic
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
            onChange={(e) => setPesel(e.target.value.replace(/\D/g, '').slice(0, 11))}
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
          {isParamedic ? (
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
