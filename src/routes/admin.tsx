import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { EmptyState } from '@/components/empty-state'
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  Copy,
  Eye,
  Flag,
  Inbox,
  CalendarClock,
  BarChart3,
  KeyRound,
  LogOut,
  Monitor,
  Pencil,
  ScrollText,
  Search,
  ShieldAlert,
  Trash2,
  ShieldPlus,
  UserCog,
  UserPlus,
  Users,
  X,
  Power,
  ShieldCheck,
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
  isExamStaffOnly,
  ROLE_EXAMINER,
  ROLE_EXAM_MOD,
  TRASH_RETENTION_DAYS,
  formatDate,
  formatDateTime,
  validityLabel,
  verificationPath,
  isParamedic,
  isPesel,
  isPwz,
  pwzFromPesel,
  type EntryStatus,
} from '@/lib/registry'
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES_ERROR,
  PASSWORD_RULES_TEXT,
  meetsPasswordPolicy,
} from '@/lib/password-strength'
import {
  addAdmin,
  addManagement,
  addPractitioner,
  bulkUpdateEntries,
  deleteAdmin,
  setCoOwner,
  deleteManagement,
  deletePractitioner,
  entryHistory,
  findPeselMatches,
  listAdmins,
  listManagement,
  listPractitioners,
  logEntriesExport,
  revealPesel,
  undoEntryChange,
  updatePractitioner,
} from '@/lib/registry.functions'
import { downloadText } from '@/lib/download'

import { AuditLogPanel } from '@/components/admin/audit-log-panel'
import { MfaForm } from '@/components/admin/mfa-form'
import { Panel } from '@/components/admin/panel'
import {
  ChangePasswordDialog,
  ResetManagementPasswordDialog,
} from '@/components/admin/password-dialogs'
import { AlertsPanel } from '@/components/admin/alerts-panel'
import { ReportsPanel } from '@/components/admin/reports-panel'
import {
  ExpiryField,
  resolveExpiry,
  type ExpiryChoice,
} from '@/components/admin/expiry-field'
import { CountBadge } from '@/components/count-badge'
import { ExpiryRequestDialog } from '@/components/admin/expiry-request-dialog'
import {
  ExpiryRequestsPanel,
  MyExpiryRequestsPanel,
} from '@/components/admin/expiry-requests-panel'
import { StatsPanel } from '@/components/admin/stats-panel'
import { SecurityCenterPanel } from '@/components/admin/security-center-panel'
import { RequestForm } from '@/components/admin/request-form'
import {
  MyRequestsPanel,
  RequestsPanel,
} from '@/components/admin/requests-panels'
import { SessionsDialog } from '@/components/admin/sessions-dialog'
import { TrashPanel } from '@/components/admin/trash-panel'
import { BadgeCard } from '@/components/badge-card'
import { getBranding } from '@/lib/branding.functions'
import { StaffNotice } from '@/components/staff-notice'
import { TodoPanel } from '@/components/admin/todo-panel'
import { WhatsNewBar } from '@/components/admin/whats-new-bar'
import { OnboardingDialog, onboardingSeen } from '@/components/admin/onboarding-dialog'
import { ExamStaffAdmin } from '@/components/examiners/exam-staff-admin'
import { AccountRolesEditor } from '@/components/admin/account-roles-editor'
import { ExamStaffPanel } from '@/components/examiners/exam-staff-panel'
import { getAdminCounts } from '@/lib/alerts.functions'
import { getMyBadge } from '@/lib/activity.functions'
import { getSiteStatus, setMaintenance } from '@/lib/site.functions'
import { appealSuspension, changeOwnPassword, currentUser, loginUser, logoutUser } from '@/lib/auth.functions'
import type { AuthUser } from '@/lib/auth-types'
import {
  endMfaSession,
  getMfaStatus,
  startPlainSession,
} from '@/lib/mfa.functions'

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
  | { phase: 'mfa'; user: AuthUser }
  | { phase: 'signed-in'; user: AuthUser }

/**
 * Where an authenticated user goes next: the e-mail code step (if enabled) or the panel.
 * `fresh` is true right after a password login. Without e-mail codes a panel session is
 * only started then, so a device that was signed out remotely has to log in again.
 */
async function resolveAuth(user: AuthUser, fresh: boolean): Promise<Auth> {
  // If the status cannot be read, fail closed and ask for the code.
  const status = await getMfaStatus().catch(() => ({
    required: true,
    verified: false,
  }))
  if (status.verified) return { phase: 'signed-in', user }
  if (status.required) return { phase: 'mfa', user }
  if (!fresh) return { phase: 'signed-out' }
  const started = await startPlainSession().catch(() => ({ ok: false as const }))
  if (!started.ok) {
    toast.error('Nie udało się rozpocząć sesji. Zaloguj się ponownie.')
    return { phase: 'signed-out' }
  }
  return { phase: 'signed-in', user }
}

function AdminPage() {
  const [auth, setAuth] = useState<Auth>({ phase: 'loading' })

  useEffect(() => {
    let active = true
    async function init() {
      const user = await currentUser().catch(() => null)
      const next: Auth = user
        ? await resolveAuth(user, false)
        : { phase: 'signed-out' }
      if (active) setAuth(next)
    }
    void init()
    return () => {
      active = false
    }
  }, [])

  async function enter(user: AuthUser) {
    setAuth(await resolveAuth(user, true))
  }

  async function signOut() {
    await endMfaSession().catch(() => undefined)
    await logoutUser().catch(() => undefined)
    setAuth({ phase: 'signed-out' })
  }

  return (
    <div className="mx-auto max-w-[1365px] px-5 py-12">
      <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-[var(--registry-navy)]">
        {auth.phase === 'signed-in' && isExamStaffOnly(auth.user.roles ?? []) ? 'Panel egzaminatora' : 'Panel administratora'}
      </h1>
      <div className="mt-8">
        {auth.phase === 'loading' && (
          <p className="text-muted-foreground">Wczytywanie…</p>
        )}
        {auth.phase === 'signed-out' && (
          <LoginForm onDone={(user) => void enter(user)} />
        )}
        {auth.phase === 'mfa' && (
          <MfaForm
            user={auth.user}
            onVerified={() => setAuth({ phase: 'signed-in', user: auth.user })}
            onLogout={() => void signOut()}
          />
        )}
        {auth.phase === 'signed-in' && auth.user.mustChangePassword && (
          <ForcedPasswordChange
            onDone={() => setAuth({ phase: 'signed-in', user: { ...auth.user, mustChangePassword: false } })}
            onLogout={() => void signOut()}
          />
        )}
        {auth.phase === 'signed-in' && !auth.user.mustChangePassword && isExamStaffOnly(auth.user.roles ?? []) && (
          <ExamStaffPanel user={auth.user} onLogout={() => void signOut()} />
        )}
        {auth.phase === 'signed-in' && !auth.user.mustChangePassword && !isExamStaffOnly(auth.user.roles ?? []) && (
          <SignedIn user={auth.user} onLogout={() => void signOut()} />
        )}
      </div>
    </div>
  )
}

/** The owner forced a password change: nothing else is available until it is done. */
function ForcedPasswordChange({ onDone, onLogout }: { onDone: () => void; onLogout: () => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const password = String(fields.get('password'))
    if (!meetsPasswordPolicy(password)) {
      setError(PASSWORD_RULES_ERROR)
      return
    }
    if (password !== String(fields.get('confirm'))) {
      setError('Hasła nie są takie same.')
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await changeOwnPassword({
        data: { currentPassword: String(fields.get('current')), newPassword: password },
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success('Hasło zostało zmienione.')
      onDone()
    } catch {
      setError('Nie udało się zmienić hasła.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="max-w-md">
      <Panel>
        <h2 className="text-lg font-semibold">Wymagana zmiana hasła</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Właściciel wymaga ustawienia nowego hasła przed dalszą pracą.
        </p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div className="space-y-2">
            <Label htmlFor="forced-current">Obecne hasło</Label>
            <Input id="forced-current" name="current" type="password" autoComplete="current-password" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="forced-new">Nowe hasło</Label>
            <Input id="forced-new" name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required />
            <p className="text-xs text-muted-foreground">{PASSWORD_RULES_TEXT}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="forced-confirm">Powtórz nowe hasło</Label>
            <Input id="forced-confirm" name="confirm" type="password" autoComplete="new-password" required />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? 'Zapisywanie…' : 'Zmień hasło'}
            </Button>
            <Button type="button" variant="outline" onClick={onLogout}>
              Wyloguj
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  )
}

function LoginForm({ onDone }: { onDone: (user: AuthUser) => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suspension, setSuspension] = useState<{
    email: string
    password: string
    until: string
    why: string | null
    appealSent: boolean
  } | null>(null)

  async function appeal() {
    if (!suspension) return
    try {
      const result = await appealSuspension({ data: { email: suspension.email, password: suspension.password } })
      if (!result.ok) {
        toast.error(result.error)
        if (/już wysłane/.test(result.error)) setSuspension({ ...suspension, appealSent: true })
        return
      }
      toast.success('Odwołanie wysłane. Moderator je zobaczy.')
      setSuspension({ ...suspension, appealSent: true })
    } catch {
      toast.error('Nie udało się wysłać odwołania.')
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    setPending(true)
    setError(null)
    setSuspension(null)
    const email = String(fields.get('email'))
    try {
      const result = await loginUser({
        data: { email, password: String(fields.get('password')) },
      })
      if (!result.ok && result.reason === 'suspended') {
        setError('Twoje konto jest zawieszone.')
        setSuspension({
          email,
          password: String(fields.get('password')),
          until: result.until,
          why: result.why,
          appealSent: result.appealSent,
        })
        return
      }
      if (!result.ok) {
        setError(
          result.reason === 'blocked'
            ? 'Logowanie z tego adresu jest teraz niedostępne (zbyt wiele prób albo adres zablokowany).'
            : result.reason === 'locked'
              ? 'To konto jest zablokowane lub chwilowo niedostępne. Skontaktuj się z właścicielem.'
              : 'Nieprawidłowy e-mail lub hasło.',
        )
        return
      }
      onDone(result.user)
    } catch {
      setError('Nie udało się zalogować. Spróbuj ponownie.')
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
              {error}
            </p>
          )}
          {suspension && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p>Zawieszenie trwa do {formatDateTime(suspension.until)}.</p>
              <p>Powód: {suspension.why ?? 'nie podano'}</p>
              {suspension.appealSent ? (
                <p className="font-medium">Odwołanie zostało wysłane. Poczekaj na odpowiedź moderatora.</p>
              ) : (
                <Button type="button" variant="outline" size="sm" onClick={() => void appeal()}>
                  Odwołaj się od zawieszenia
                </Button>
              )}
            </div>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Logowanie…' : 'Zaloguj się'}
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

/** Faint, repeated e-mail of the signed-in person over the whole panel, so screenshots can be traced back. */
function Watermark({ email }: { email: string }) {
  const safe = email.replace(/[<>&"']/g, '')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><text x="20" y="100" transform="rotate(-24 160 90)" font-family="sans-serif" font-size="15" fill="#64748b" fill-opacity="0.16">${safe}</text></svg>`
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 select-none"
      style={{ backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`, backgroundRepeat: 'repeat' }}
    />
  )
}

const TABLE_WIDTH_KEY = 'people-table-width'
const DEFAULT_TABLE_WIDTH = 1365
const MIN_TABLE_WIDTH = 700
const MAX_TABLE_WIDTH = 3000

function SignedIn({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  // Width of the table of people is a personal setting, remembered in this browser.
  const [tableWidth, setTableWidthState] = useState(DEFAULT_TABLE_WIDTH)
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(TABLE_WIDTH_KEY))
      if (saved >= MIN_TABLE_WIDTH && saved <= MAX_TABLE_WIDTH) setTableWidthState(saved)
    } catch {
      // storage unavailable: keep the default
    }
  }, [])
  const resizeRef = useRef<{ x: number; width: number } | null>(null)
  function setTableWidth(next: number) {
    setTableWidthState(next)
    try {
      localStorage.setItem(TABLE_WIDTH_KEY, String(next))
    } catch {
      // the width then lasts until reload
    }
  }

  const isAdmin = user.roles?.includes(ROLE_ADMIN) ?? false
  const isManagement = user.roles?.includes(ROLE_MANAGEMENT) ?? false
  // kierownictwo may also be an examiner or moderator of examiners: that work stays one click away.
  const hasExamRole = !isAdmin && (user.roles?.includes(ROLE_EXAMINER) || user.roles?.includes(ROLE_EXAM_MOD)) === true
  /** False when the owner switched this permission off for this account (the buttons are hidden). */
  const can = (key: string) => !(user.denied ?? []).includes(key)
  const canAdd = isAdmin || isManagement
  useEffect(() => {
    if (isManagement && !isAdmin && !onboardingSeen(user.email)) setTutorialOpen(true)
  }, [isManagement, isAdmin, user.email])
  const [rows, setRows] = useState<Row[] | null>(null)
  const [editing, setEditing] = useState<Row | null>(null)
  const [managementOpen, setManagementOpen] = useState(false)
  const [adminDialogOpen, setAdminDialogOpen] = useState(false)
  const [showAdmins, setShowAdmins] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [showManagement, setShowManagement] = useState(false)
  const [showExamStaff, setShowExamStaff] = useState(false)
  const [showExamWork, setShowExamWork] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const [showRequests, setShowRequests] = useState(false)
  const [showReports, setShowReports] = useState(false)
  const [showAlerts, setShowAlerts] = useState(false)
  const [showStats, setShowStats] = useState(false)
  const [showSecurity, setShowSecurity] = useState(false)
  const [maintenance, setMaintenanceState] = useState<{ closed: boolean; message: string } | null>(null)
  const [expiryRow, setExpiryRow] = useState<Row | null>(null)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  // Bumped after every change so open panels (log, trash, accounts) reload themselves.
  const [logVersion, setLogVersion] = useState(0)
  const [tutorialOpen, setTutorialOpen] = useState(false)
  const [watermarkOn, setWatermarkOn] = useState(true)
  // "Do zrobienia teraz" can be hidden; the choice is remembered in this browser.
  const [todoHidden, setTodoHidden] = useState(false)
  useEffect(() => {
    try {
      setTodoHidden(localStorage.getItem('todo-hidden') === '1')
    } catch {
      // keep it visible
    }
  }, [])
  function setTodoHiddenSaved(hidden: boolean) {
    setTodoHidden(hidden)
    try {
      if (hidden) localStorage.setItem('todo-hidden', '1')
      else localStorage.removeItem('todo-hidden')
    } catch {
      // lasts until reload
    }
  }
  useEffect(() => {
    getBranding()
      .then((branding) => setWatermarkOn(branding.watermark))
      .catch(() => undefined)
  }, [logVersion])
  const [counts, setCounts] = useState({ requests: 0, reports: 0, alerts: 0 })
  const [peselIds, setPeselIds] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [query, setQuery] = useState('')
  const [professionFilter, setProfessionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [authorFilter, setAuthorFilter] = useState('')
  const [sort, setSort] = useState<Sort>({ key: 'date', dir: 'desc' })

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

  useEffect(() => {
    if (!isAdmin) return
    getSiteStatus()
      .then(setMaintenanceState)
      .catch(() => undefined)
  }, [isAdmin])

  async function toggleMaintenance() {
    if (!maintenance) return
    const closing = !maintenance.closed
    let message: string | undefined
    if (closing) {
      const typed = window.prompt(
        'Komunikat dla odwiedzających (zostaw puste, aby użyć domyślnego):',
        '',
      )
      if (typed === null) return
      message = typed
    } else if (!window.confirm('Otworzyć rejestr ponownie dla odwiedzających?')) {
      return
    }
    try {
      const result = await setMaintenance({ data: { closed: closing, message } })
      setMaintenanceState(result)
      setLogVersion((version) => version + 1)
      toast.success(closing ? 'Rejestr zamknięty (tryb awaryjny).' : 'Rejestr otwarty.')
    } catch {
      toast.error('Nie udało się zmienić trybu awaryjnego.')
    }
  }

  // What needs an admin's attention (requests, reports, alerts); checked every minute.
  useEffect(() => {
    if (!isAdmin) return
    let active = true
    let previous: typeof counts | null = null
    async function check() {
      try {
        const next = await getAdminCounts()
        if (!active) return
        if (previous) {
          if (next.requests > previous.requests) toast.info('Nowy wniosek o wpis czeka na decyzję.')
          if (next.reports > previous.reports) toast.info('Nowe zgłoszenie błędu w rejestrze.')
          if (next.alerts > previous.alerts) toast.warning('Nowy alert bezpieczeństwa.')
        }
        previous = next
        setCounts(next)
      } catch {
        // ignore: the next check will try again
      }
    }
    void check()
    const timer = setInterval(() => void check(), 60_000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [isAdmin, logVersion])

  // Searching by PESEL happens on the server, so PESEL numbers are never part of the list.
  useEffect(() => {
    const digits = query.trim()
    if (!/^\d{6,100}$/.test(digits)) {
      setPeselIds(new Set())
      return
    }
    let active = true
    const timer = setTimeout(() => {
      findPeselMatches({ data: { q: digits } })
        .then((r) => {
          if (active) setPeselIds(new Set(r.ids))
        })
        .catch(() => undefined)
    }, 300)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [query])

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
            (matchesQuery(row, query) || peselIds.has(row.id)) &&
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
      {watermarkOn && <Watermark email={user.email} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Zalogowano jako <strong className="text-foreground">{user.email}</strong>
        </p>
        <div className="flex gap-2">
          {isManagement && !isAdmin && (
            <Button variant="outline" size="sm" onClick={() => setTutorialOpen(true)}>
              Samouczek
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setSessionsOpen(true)}>
            <Monitor className="size-4" /> Urządzenia
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPasswordOpen(true)}>
            <KeyRound className="size-4" /> Zmień hasło
          </Button>
          <Button variant="outline" size="sm" onClick={onLogout}>
            <LogOut className="size-4" /> Wyloguj
          </Button>
        </div>
      </div>
      <StaffNotice />
      <WhatsNewBar />
      {isManagement && !isAdmin && (
        <OnboardingDialog email={user.email} open={tutorialOpen} onOpenChange={setTutorialOpen} />
      )}
      {isAdmin && todoHidden && (
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={() => setTodoHiddenSaved(false)}>
            Pokaż „Do zrobienia teraz”
          </Button>
        </div>
      )}
      {isAdmin && !todoHidden && (
        <TodoPanel
          onHide={() => setTodoHiddenSaved(true)}
          key={`todo-${logVersion}`}
          onOpen={(target) => {
            if (target === 'requests') setShowRequests(true)
            else if (target === 'reports') setShowReports(true)
            else if (target === 'alerts') setShowAlerts(true)
            else setShowSecurity(true)
          }}
        />
      )}
      <ChangePasswordDialog
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
      />
      <SessionsDialog
        open={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        onSignedOutEverywhere={onLogout}
      />

      {hasExamRole && (
        <div className="flex flex-wrap gap-2">
          <Button variant={showExamWork ? 'default' : 'outline'} onClick={() => setShowExamWork((open) => !open)}>
            <Users className="size-4" /> Panel {user.roles?.includes(ROLE_EXAM_MOD) ? 'moderatora egzaminatorów' : 'egzaminatora'}
          </Button>
        </div>
      )}
      {hasExamRole && showExamWork && (
        <Closable onClose={() => setShowExamWork(false)}>
          <ExamStaffPanel user={user} onLogout={onLogout} />
        </Closable>
      )}

      {isAdmin && (
        <div className="flex flex-wrap gap-2">
{can('accounts.management') && (
<>
          <Button variant="outline" onClick={() => setManagementOpen(true)}>
            <UserCog className="size-4" /> Dodaj kierownictwo
          </Button>
          <Button
            variant={showManagement ? 'default' : 'outline'}
            onClick={() => setShowManagement((open) => !open)}
          >
            <Users className="size-4" /> Konta kierownictwa
          </Button>
</>
)}
{can('examstaff.manage') && (
          <Button
            variant={showExamStaff ? 'default' : 'outline'}
            onClick={() => setShowExamStaff((open) => !open)}
          >
            <Users className="size-4" /> Egzaminatorzy
          </Button>
)}
          {user.isSuperAdmin && (
            <>
              <Button variant="outline" onClick={() => setAdminDialogOpen(true)}>
                <ShieldPlus className="size-4" /> Dodaj administratora
              </Button>
              <Button
                variant={showSecurity ? 'default' : 'outline'}
                onClick={() => setShowSecurity((open) => !open)}
              >
                <ShieldCheck className="size-4" /> Centrum bezpieczeństwa
              </Button>
              <Button asChild variant="outline">
                <Link to="/egzaminy">Egzaminy (beta)</Link>
              </Button>
              <Button
                variant={showAdmins ? 'default' : 'outline'}
                onClick={() => setShowAdmins((open) => !open)}
              >
                <Users className="size-4" /> Konta administratorów
              </Button>
            </>
          )}
{can('requests.decide') && (
          <Button
            className="relative"
            variant={showRequests ? 'default' : 'outline'}
            onClick={() => setShowRequests((open) => !open)}
          >
            <Inbox className="size-4" /> Wnioski
            <CountBadge count={counts.requests} />
          </Button>
)}
{can('reports.manage') && (
          <Button
            className="relative"
            variant={showReports ? 'default' : 'outline'}
            onClick={() => setShowReports((open) => !open)}
          >
            <Flag className="size-4" /> Zgłoszenia
            <CountBadge count={counts.reports} />
          </Button>
)}
          <Button
            className="relative"
            variant={showAlerts ? 'default' : 'outline'}
            onClick={() => setShowAlerts((open) => !open)}
          >
            <ShieldAlert className="size-4" /> Alerty
            <CountBadge count={counts.alerts} />
          </Button>
          <Button
            variant={maintenance?.closed ? 'destructive' : 'outline'}
            disabled={maintenance === null}
            onClick={() => void toggleMaintenance()}
          >
            <Power className="size-4" />{' '}
            {maintenance?.closed ? 'Otwórz rejestr' : 'Tryb awaryjny'}
          </Button>
          <Button
            variant={showStats ? 'default' : 'outline'}
            onClick={() => setShowStats((open) => !open)}
          >
            <BarChart3 className="size-4" /> Statystyki
          </Button>
{can('entries.trash') && (
          <Button
            variant={showTrash ? 'default' : 'outline'}
            onClick={() => setShowTrash((open) => !open)}
          >
            <Trash2 className="size-4" /> Kosz
          </Button>
)}
{can('audit.view') && (
          <Button
            variant={showLog ? 'default' : 'outline'}
            onClick={() => setShowLog((open) => !open)}
          >
            <ScrollText className="size-4" /> Dziennik zdarzeń
          </Button>
)}
        </div>
      )}
      {isAdmin && showManagement && (
        <Closable onClose={() => setShowManagement(false)}>
          <ManagementPanel
            key={logVersion}
            onChanged={() => setLogVersion((version) => version + 1)}
          />
        </Closable>
      )}
      {isAdmin && showExamStaff && (
        <Closable onClose={() => setShowExamStaff(false)}>
          <ExamStaffAdmin onChanged={() => setLogVersion((version) => version + 1)} />
        </Closable>
      )}
      {user.isSuperAdmin && showAdmins && (
        <Closable onClose={() => setShowAdmins(false)}>
          <ManagementPanel
            key={`admins-${logVersion}`}
            kind="admin"
            canGrantCoOwner={user.isRootOwner === true}
            onChanged={() => setLogVersion((version) => version + 1)}
          />
        </Closable>
      )}
      {isAdmin && showAlerts && (
        <Closable onClose={() => setShowAlerts(false)}>
          <AlertsPanel key={logVersion} onChanged={() => setLogVersion((version) => version + 1)} />
        </Closable>
      )}
      {isAdmin && showReports && (
        <Closable onClose={() => setShowReports(false)}>
          <ReportsPanel key={logVersion} onChanged={() => setLogVersion((version) => version + 1)} />
        </Closable>
      )}
      {isAdmin && showRequests && (
        <Closable onClose={() => setShowRequests(false)}>
          <RequestsPanel key={logVersion} onChanged={() => void refreshAll()} />
          <div className="mt-6">
            <ExpiryRequestsPanel key={`exp-${logVersion}`} onChanged={() => void refreshAll()} />
          </div>
        </Closable>
      )}
      {user.isSuperAdmin && showSecurity && (
        <Closable onClose={() => setShowSecurity(false)}>
          <SecurityCenterPanel />
        </Closable>
      )}
      {isAdmin && showStats && (
        <Closable onClose={() => setShowStats(false)}>
          <StatsPanel />
        </Closable>
      )}
      {isAdmin && showTrash && (
        <Closable onClose={() => setShowTrash(false)}>
          <TrashPanel key={logVersion} onChanged={() => void refreshAll()} />
        </Closable>
      )}
      {isAdmin && showLog && (
        <Closable onClose={() => setShowLog(false)}>
          <AuditLogPanel key={logVersion} />
        </Closable>
      )}
      {isAdmin && (
        <>
          <ManagementDialog
            open={managementOpen}
            onClose={() => setManagementOpen(false)}
            onCreated={() => setLogVersion((version) => version + 1)}
          />
          {user.isSuperAdmin && (
            <ManagementDialog
              kind="admin"
              open={adminDialogOpen}
              onClose={() => setAdminDialogOpen(false)}
              onCreated={() => setLogVersion((version) => version + 1)}
            />
          )}
        </>
      )}

      {!canAdd ? (
        <Panel>
          <p>
            To konto nie ma uprawnień do panelu. Nadaj mu rolę{' '}
            <code className="rounded bg-muted px-1">{ROLE_ADMIN}</code> lub{' '}
            <code className="rounded bg-muted px-1">{ROLE_MANAGEMENT}</code> w
            panelu właściciela, a następnie zaloguj się ponownie.
          </p>
        </Panel>
      ) : (
        <>
          {isAdmin ? (
            <AddForm onAdded={refreshAll} />
          ) : (
            <>
              <MyBadgeLine />
              <RequestForm
                onSubmitted={() => setLogVersion((version) => version + 1)}
              />
              <MyRequestsPanel key={logVersion} />
              <MyExpiryRequestsPanel key={`myexp-${logVersion}`} />
            </>
          )}
          <div
            style={{
              width: `min(${tableWidth}px, calc(100vw - 2.5rem))`,
              position: 'relative',
              left: '50%',
              transform: 'translateX(-50%)',
            }}
          >
          {(['left', 'right'] as const).map((side) => (
            <div
              key={side}
              role="separator"
              aria-orientation="vertical"
              aria-label="Przeciągnij, aby zmienić szerokość tabeli"
              title="Przeciągnij, aby zmienić szerokość tabeli"
              className={`absolute inset-y-0 z-10 w-3 cursor-ew-resize touch-none rounded bg-transparent transition-colors hover:bg-primary/30 active:bg-primary/40 ${side === 'left' ? '-left-1.5' : '-right-1.5'}`}
              onPointerDown={(e) => {
                e.preventDefault()
                e.currentTarget.setPointerCapture(e.pointerId)
                resizeRef.current = { x: e.clientX, width: e.currentTarget.parentElement?.offsetWidth ?? tableWidth }
              }}
              onPointerMove={(e) => {
                const start = resizeRef.current
                if (!start) return
                const dx = (e.clientX - start.x) * (side === 'left' ? -1 : 1)
                // the table is centred, so each pixel dragged widens it on both sides
                const next = Math.round(start.width + dx * 2)
                setTableWidth(Math.min(MAX_TABLE_WIDTH, Math.max(MIN_TABLE_WIDTH, next)))
              }}
              onPointerUp={() => {
                resizeRef.current = null
              }}
              onPointerCancel={() => {
                resizeRef.current = null
              }}
            />
          ))}
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              Osoby w rejestrze
              {rows
                ? filtering
                  ? ` (${visible.length} z ${rows.length})`
                  : ` (${rows.length})`
                : ''}
            </h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              Szerokość: przeciągnij lewy lub prawy brzeg tabeli
              <span className="font-mono">{tableWidth} px</span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setTableWidth(DEFAULT_TABLE_WIDTH)}>
                Resetuj
              </Button>
            </div>
            </div>
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
                {isAdmin && selected.size > 0 && (
                  <BulkBar
                    ids={[...selected]}
                    rows={rows}
                    onClear={() => setSelected(new Set())}
                    onDone={async () => {
                      setSelected(new Set())
                      await refreshAll()
                    }}
                  />
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      {isAdmin && (
                        <TableHead className="w-8">
                          <input
                            type="checkbox"
                            aria-label="Zaznacz wszystkie widoczne wpisy"
                            checked={visible.length > 0 && visible.every((row) => selected.has(row.id))}
                            onChange={(e) =>
                              setSelected(e.target.checked ? new Set(visible.map((row) => row.id)) : new Set())
                            }
                          />
                        </TableHead>
                      )}
                      <SortHead label="Imię i nazwisko" sortKey="name" sort={sort} onSort={toggleSort} />
                      <TableHead>PESEL</TableHead>
                      <SortHead label="PWZ" sortKey="pwz" sort={sort} onSort={toggleSort} />
                      <SortHead label="Zawód" sortKey="profession" sort={sort} onSort={toggleSort} />
                      <TableHead>Specjalizacja</TableHead>
                      <SortHead label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                      <TableHead className={isAdmin ? 'w-36' : 'w-24'} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((row) => (
                      <TableRow key={row.id} data-state={selected.has(row.id) ? 'selected' : undefined}>
                        {isAdmin && (
                          <TableCell className="w-8">
                            <input
                              type="checkbox"
                              aria-label={`Zaznacz wpis ${row.firstName} ${row.lastName}`}
                              checked={selected.has(row.id)}
                              onChange={(e) =>
                                setSelected((current) => {
                                  const next = new Set(current)
                                  if (e.target.checked) next.add(row.id)
                                  else next.delete(row.id)
                                  return next
                                })
                              }
                            />
                          </TableCell>
                        )}
                        <TableCell className="font-medium">
                          {row.firstName} {row.lastName}
                          <span className="block text-xs font-normal text-muted-foreground">
                            Nr {row.entryNumber} · {formatDate(row.entryDate)}
                            {row.createdBy ? ` · dodał(a): ${row.createdBy}` : ''}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono">
                          <PeselCell id={row.id} value={isAdmin ? row.pesel : null} />
                        </TableCell>
                        <TableCell className="font-mono">{row.pwz}</TableCell>
                        <TableCell>{row.profession}</TableCell>
                        <TableCell>{row.specialization}</TableCell>
                        <TableCell>
                          <StatusBadge status={row.status} />
                          <p className="mt-1 text-xs text-muted-foreground">
                            Ważność: {validityLabel(row.expiresAt)}
                          </p>
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
                          {!isAdmin && isManagement && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Wniosek o zmianę terminu"
                              aria-label={`Zmień termin: ${row.firstName} ${row.lastName}`}
                              onClick={() => setExpiryRow(row)}
                            >
                              <CalendarClock className="size-4" />
                            </Button>
                          )}
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
                  <EmptyState kind="people">Brak osób pasujących do wybranych kryteriów.</EmptyState>
                )}
              </div>
            )}
          </Panel>
          </div>
          {!isAdmin && isManagement && (
            <ExpiryRequestDialog
              key={expiryRow?.id ?? 'none'}
              person={expiryRow}
              onClose={() => setExpiryRow(null)}
              onSubmitted={() => setLogVersion((version) => version + 1)}
            />
          )}
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

/**
 * A visible PESEL cannot be selected or copied by hand; the "Kopiuj" button copies it and the
 * copy is written to the audit log. (Screenshots cannot be prevented; the watermark covers those.)
 */
function ProtectedPesel({ id, value, onHide }: { id: number; value: string; onHide?: () => void }) {
  const [busy, setBusy] = useState(false)
  const block = (e: { preventDefault: () => void }) => e.preventDefault()

  async function copy() {
    setBusy(true)
    try {
      const result = await revealPesel({ data: { id, purpose: 'kopiowanie' } })
      if (result.error || !result.pesel) {
        toast.error(result.error ?? 'Nie udało się skopiować.')
        return
      }
      await navigator.clipboard.writeText(result.pesel)
      toast.success('PESEL skopiowany (zapisano w dzienniku).')
    } catch {
      toast.error('Nie udało się skopiować numeru PESEL.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="select-none font-mono"
        onCopy={block}
        onCut={block}
        onDragStart={block}
        onClick={onHide}
        title={onHide ? 'Ukryj' : undefined}
        style={{ cursor: onHide ? 'pointer' : 'default' }}
      >
        {value}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => void copy()}
        className="text-muted-foreground hover:text-foreground"
        aria-label="Kopiuj PESEL (zapisywane w dzienniku)"
        title="Kopiuj (zapisywane w dzienniku)"
      >
        <Copy className="size-3.5" />
      </button>
    </span>
  )
}

/** PESEL is hidden by default; showing it is audited and it hides itself again after a while. */
function PeselCell({ id, value }: { id: number; value: string | null }) {
  const [pesel, setPesel] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (pesel === null) return
    const timer = setTimeout(() => setPesel(null), 30_000)
    return () => clearTimeout(timer)
  }, [pesel])

  async function reveal() {
    setPending(true)
    try {
      const result = await revealPesel({ data: { id, purpose: 'podgląd w tabeli' } })
      if (result.error) toast.error(result.error)
      setPesel(result.pesel)
    } catch {
      toast.error('Nie udało się odsłonić numeru PESEL.')
    } finally {
      setPending(false)
    }
  }

  if (value) return <ProtectedPesel id={id} value={value} />
  if (pesel !== null) {
    return (
      <ProtectedPesel id={id} value={pesel} onHide={() => setPesel(null)} />
    )
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => void reveal()}
      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
      aria-label="Pokaż numer PESEL"
    >
      <span aria-hidden>•••••••••••</span>
      <Eye className="size-3.5" />
    </button>
  )
}

const KEEP_EXPIRY: ExpiryChoice = { mode: 'keep', amount: '', unit: 'months' }
const LIFETIME_EXPIRY: ExpiryChoice = { mode: 'lifetime', amount: '', unit: 'months' }

const filterSelectClass =
  'h-9 rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

type ManagementRow = Awaited<ReturnType<typeof listManagement>>[number]

function ManagementPanel({
  onChanged,
  kind = 'management',
  canGrantCoOwner = false,
}: {
  onChanged: () => void
  kind?: 'management' | 'admin'
  /** The real owner may give admins the owner's powers (co-owner). */
  canGrantCoOwner?: boolean
}) {
  const isAdminKind = kind === 'admin'
  const accountLabel = isAdminKind ? 'administratora' : 'kierownictwa'
  const [rows, setRows] = useState<ManagementRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [resetTarget, setResetTarget] = useState<ManagementRow | null>(null)
  const [rolesFor, setRolesFor] = useState<string | null>(null)

  async function toggleCoOwner(row: ManagementRow) {
    const grant = !row.isCoOwner
    if (
      !confirm(
        grant
          ? `Nadać ${row.email} uprawnienia superadmina? Ta osoba dostanie prawie wszystkie uprawnienia właściciela (konta administratorów, Centrum bezpieczeństwa, uprawnienia). Nie będzie mogła zmieniać Twojego konta ani nadawać superadmina innym.`
          : `Odebrać ${row.email} uprawnienia superadmina? Osoba zostanie wylogowana i zostanie zwykłym administratorem.`,
      )
    ) {
      return
    }
    try {
      const result = await setCoOwner({ data: { id: row.id, on: grant } })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(grant ? 'Nadano uprawnienia superadmina.' : 'Odebrano uprawnienia superadmina.')
      onChanged()
    } catch {
      toast.error('Nie udało się zmienić uprawnień.')
    }
  }

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setRows(await (isAdminKind ? listAdmins() : listManagement()))
    } catch {
      setFailed(true)
      setRows([])
    }
  }, [isAdminKind])

  useEffect(() => {
    void load()
  }, [load])

  async function remove(row: ManagementRow) {
    if (
      !confirm(
        `Usunąć konto ${accountLabel} ${row.email}? Ta osoba nie będzie mogła się już zalogować.`,
      )
    ) {
      return
    }
    try {
      const result = await (isAdminKind ? deleteAdmin : deleteManagement)({
        data: { id: row.id },
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(isAdminKind ? 'Konto administratora usunięte.' : 'Konto kierownictwa usunięte.')
      onChanged() // remounts this panel, which reloads the list
    } catch {
      toast.error('Nie udało się usunąć konta.')
    }
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Users className="size-5" /> Konta {isAdminKind ? 'administratorów' : 'kierownictwa'}
          {rows && !failed ? ` (${rows.length})` : ''}
        </h2>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Odśwież
        </Button>
      </div>
      <ResetManagementPasswordDialog
        kind={kind}
        target={resetTarget}
        onClose={() => setResetTarget(null)}
        onDone={onChanged}
      />
      {rows === null ? (
        <p className="mt-4 text-muted-foreground">Wczytywanie…</p>
      ) : failed ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          Nie udało się wczytać kont {isAdminKind ? 'administratorów' : 'kierownictwa'}.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-muted-foreground">
          {isAdminKind
            ? 'Brak kont administratorów.'
            : 'Brak kont kierownictwa. Dodaj pierwsze przyciskiem „Dodaj kierownictwo”.'}
        </p>
      ) : (
        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>E-mail</TableHead>
                <TableHead className="w-64" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.email}
                    {row.isOwner ? ' (właściciel)' : ''}
                    {row.isCoOwner ? ' (superadmin)' : ''}
                    {!isAdminKind && row.roles.includes(ROLE_EXAMINER) ? ' · egzaminator' : ''}
                    {!isAdminKind && row.roles.includes(ROLE_EXAM_MOD) ? ' · moderator' : ''}
                    {rolesFor === row.id && (
                      <div className="mt-2 font-normal">
                        <AccountRolesEditor
                          account={row}
                          onChanged={() => {
                            setRolesFor(null)
                            onChanged()
                          }}
                        />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {!isAdminKind && (
                      <Button variant="ghost" size="sm" onClick={() => setRolesFor(rolesFor === row.id ? null : row.id)}>
                        Role
                      </Button>
                    )}
                    {isAdminKind && canGrantCoOwner && !row.isOwner && (
                      <Button variant="ghost" size="sm" onClick={() => void toggleCoOwner(row)}>
                        {row.isCoOwner ? 'Odbierz superadmina' : 'Nadaj superadmina'}
                      </Button>
                    )}
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
                      aria-label={`Usuń konto ${accountLabel} ${row.email}`}
                      disabled={row.isOwner}
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
  kind = 'management',
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
  kind?: 'management' | 'admin'
}) {
  const isAdminKind = kind === 'admin'
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
      const result = await (isAdminKind ? addAdmin : addManagement)({
        data: {
          email: String(fields.get('email')),
          password: String(fields.get('password')),
        },
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      toast.success(`${isAdminKind ? 'Dodano konto administratora' : 'Dodano konto kierownictwa'}: ${result.email}`)
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
          <DialogTitle>{isAdminKind ? 'Dodaj konto administratora' : 'Dodaj konto kierownictwa'}</DialogTitle>
          <DialogDescription>
            {isAdminKind
              ? 'Tworzy konto z rolą admin: dodaje, edytuje i usuwa wpisy, akceptuje wnioski oraz zarządza kontami kierownictwa. Tylko właściciel może dodawać administratorów. Przekaż osobie e-mail i hasło początkowe.'
              : 'Tworzy konto z rolą kierownictwo: składa wnioski o wpis (jeden na 5 minut, ze zrzutem ekranu; akceptuje je administrator), widzi PESEL i tworzy plakietki, ale nie edytuje ani nie usuwa wpisów. Przekaż osobie e-mail i hasło początkowe.'}
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
              minLength={PASSWORD_MIN_LENGTH}
              required
            />
            <p className="text-xs text-muted-foreground">{PASSWORD_RULES_TEXT}</p>
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

/** kierownictwo: shows the account's badge for approved requests. */
function MyBadgeLine() {
  const [info, setInfo] = useState<{ approved: number; badge: string | null } | null>(null)
  useEffect(() => {
    getMyBadge()
      .then(setInfo)
      .catch(() => undefined)
  }, [])
  if (!info) return null
  return (
    <p className="text-sm text-muted-foreground">
      Twoja odznaka: <strong>{info.badge ?? 'jeszcze brak'}</strong> (przyjętych wniosków: {info.approved}).
      Kolejne progi: 1, 10, 50 i 100.
    </p>
  )
}

/** Wraps an opened panel with a visible "Zamknij" button. */
function Closable({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="mb-1 flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          <X className="size-4" /> Zamknij
        </Button>
      </div>
      {children}
    </div>
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
  const [expiry, setExpiry] = useState<ExpiryChoice>(KEEP_EXPIRY)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const paramedic = row ? isParamedic(row.profession) : false

  const [loadingPesel, setLoadingPesel] = useState(false)

  // Reset the form whenever a different entry is opened (the PESEL is fetched, and audited).
  useEffect(() => {
    setPesel('')
    setPwz(row?.pwz ?? '')
    setSpecialization(row?.rawSpecialization ?? '')
    setStatus(row?.storedStatus ?? 'active')
    setExpiry(KEEP_EXPIRY)
    setError(null)
    if (!row) return
    if (row.pesel) {
      setPesel(row.pesel)
      setLoadingPesel(false)
      return
    }
    let active = true
    setLoadingPesel(true)
    revealPesel({ data: { id: row.id, purpose: 'edycja wpisu' } })
      .then((r) => {
        if (!active) return
        if (r.error) setError(r.error)
        setPesel(r.pesel ?? '')
      })
      .catch(() => {
        if (active) setError('Nie udało się wczytać numeru PESEL.')
      })
      .finally(() => {
        if (active) setLoadingPesel(false)
      })
    return () => {
      active = false
    }
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
    const resolved = resolveExpiry(expiry)
    if (!resolved.ok) {
      setError(resolved.error)
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
          expiresAt: resolved.value,
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
          {row && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Podgląd plakietki na żywo</p>
              <BadgeCard
                scale={1.1}
                layout="horizontal"
                url={`${typeof window === 'undefined' ? '' : window.location.origin}${verificationPath(pwz || row.pwz)}`}
                badge={{
                  firstName: row.firstName,
                  lastName: row.lastName,
                  pesel,
                  pwz: pwz || row.pwz,
                  profession: row.profession,
                  expiresAt: row.expiresAt ?? null,
                }}
              />
            </div>
          )}
          <ExpiryField
            id="edit-expiry"
            value={expiry}
            onChange={setExpiry}
            allowKeep
            currentLabel={validityLabel(row?.expiresAt ?? null)}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {row && (
            <EntryHistory
              rowId={row.id}
              onUndone={async () => {
                onClose()
                await onSaved()
              }}
            />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Anuluj
            </Button>
            <Button type="submit" disabled={pending || loadingPesel}>
              {pending ? 'Zapisywanie…' : 'Zapisz zmiany'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Admin: latest changes of one entry, with undo of the newest one. */
function EntryHistory({ rowId, onUndone }: { rowId: number; onUndone: () => Promise<void> }) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof entryHistory>> | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    setItems(null)
    entryHistory({ data: { id: rowId } })
      .then((result) => {
        if (active) setItems(result)
      })
      .catch(() => {
        if (active) setItems([])
      })
    return () => {
      active = false
    }
  }, [rowId])

  async function undo() {
    if (!window.confirm('Cofnąć ostatnią zmianę tego wpisu?')) return
    setBusy(true)
    try {
      const result = await undoEntryChange({ data: { id: rowId } })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Cofnięto ostatnią zmianę.')
      await onUndone()
    } catch {
      toast.error('Nie udało się cofnąć zmiany.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Historia zmian wpisu</p>
        <Button type="button" variant="outline" size="sm" disabled={busy || !items || items.length === 0} onClick={() => void undo()}>
          Cofnij ostatnią zmianę
        </Button>
      </div>
      {items === null ? (
        <p className="text-xs text-muted-foreground">Wczytywanie…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Brak zapisanych zmian.</p>
      ) : (
        <ul className="max-h-32 divide-y overflow-y-auto rounded-md border text-xs">
          {items.map((item) => (
            <li key={item.id} className="px-2 py-1">
              <span className="text-muted-foreground">{formatDateTime(item.createdAt)} · {item.actor}</span>
              <br />
              {item.summary}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type BulkAction =
  | { type: 'status'; status: EntryStatus }
  | { type: 'expiry'; expiresAt: string | null }
  | { type: 'delete' }

type BulkRow = { id: number; firstName: string; lastName: string; pesel: string | null; pwz: string; profession: string; specialization: string | null; status: EntryStatus; expiresAt: string | null }

function csvCell(value: string | null) {
  return `"${(value ?? '').replace(/"/g, '""')}"`
}

/** Admin: actions on the ticked entries: status, validity, trash and CSV export. */
function BulkBar({
  ids,
  rows,
  onClear,
  onDone,
}: {
  ids: number[]
  rows: BulkRow[]
  onClear: () => void
  onDone: () => Promise<void>
}) {
  const [status, setStatus] = useState<EntryStatus>('suspended')
  const [expiry, setExpiry] = useState('lifetime')
  const [busy, setBusy] = useState(false)

  async function run(action: BulkAction, question: string) {
    if (!window.confirm(`${question} (${ids.length} wpisów)`)) return
    setBusy(true)
    try {
      const result = await bulkUpdateEntries({ data: { ids, action } })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(`Gotowe. Zmieniono wpisów: ${result.done}.`)
      await onDone()
    } catch {
      toast.error('Nie udało się wykonać akcji zbiorczej.')
    } finally {
      setBusy(false)
    }
  }

  function expiryValue(): string | null {
    if (expiry === 'lifetime') return null
    const date = new Date()
    if (expiry === '30d') date.setDate(date.getDate() + 30)
    else if (expiry === '3m') date.setMonth(date.getMonth() + 3)
    else date.setFullYear(date.getFullYear() + 1)
    return date.toISOString()
  }

  async function exportCsv() {
    const chosen = rows.filter((row) => ids.includes(row.id))
    const header = ['Imię', 'Nazwisko', 'PESEL', 'PWZ', 'Zawód', 'Specjalizacja', 'Status', 'Ważność']
    const lines = chosen.map((row) =>
      [row.firstName, row.lastName, row.pesel, row.pwz, row.profession, row.specialization, ENTRY_STATUSES[row.status], validityLabel(row.expiresAt)]
        .map(csvCell)
        .join(';'),
    )
    try {
      await logEntriesExport({ data: { count: chosen.length } })
    } catch {
      toast.error('Nie udało się zapisać eksportu w dzienniku, plik nie został utworzony.')
      return
    }
    downloadText('wpisy-rejestru.csv', `\uFEFF${[header.map(csvCell).join(';'), ...lines].join('\r\n')}`, 'text/csv;charset=utf-8')
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2 text-sm">
      <strong>Zaznaczono: {ids.length}</strong>
      <select className={filterSelectClass} value={status} onChange={(e) => setStatus(e.target.value as EntryStatus)} aria-label="Nowy status">
        {ENTRY_STATUS_KEYS.map((k) => (
          <option key={k} value={k}>{ENTRY_STATUSES[k]}</option>
        ))}
      </select>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run({ type: 'status', status }, `Zmienić status na „${ENTRY_STATUSES[status]}”?`)}>
        Zmień status
      </Button>
      <select className={filterSelectClass} value={expiry} onChange={(e) => setExpiry(e.target.value)} aria-label="Nowa ważność">
        <option value="lifetime">Dożywotnio</option>
        <option value="30d">30 dni od dziś</option>
        <option value="3m">3 miesiące od dziś</option>
        <option value="12m">12 miesięcy od dziś</option>
      </select>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run({ type: 'expiry', expiresAt: expiryValue() }, 'Ustawić nowy termin ważności?')}>
        Ustaw ważność
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void exportCsv()}>
        Eksport CSV
      </Button>
      <Button size="sm" variant="destructive" disabled={busy} onClick={() => void run({ type: 'delete' }, 'Przenieść zaznaczone wpisy do kosza?')}>
        Do kosza
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear}>Odznacz</Button>
    </div>
  )
}

const selectClass =
  'h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

/** Admin only: adds a person directly (kierownictwo uses RequestForm instead). */
function AddForm({ onAdded }: { onAdded: () => Promise<void> }) {
  const [expiry, setExpiry] = useState<ExpiryChoice>(LIFETIME_EXPIRY)
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
    const resolved = resolveExpiry(expiry)
    if (!resolved.ok) {
      setError(resolved.error)
      return
    }
    setPending(true)
    setError(null)
    try {
      const result = await addPractitioner({
        data: {
          expiresAt: resolved.value ?? null,
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
      setExpiry(LIFETIME_EXPIRY)
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
        <div className="sm:col-span-2">
          <ExpiryField id="add-expiry" value={expiry} onChange={setExpiry} />
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
