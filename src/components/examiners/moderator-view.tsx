import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { PauseCircle, PlayCircle, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'

import { Panel } from '@/components/admin/panel'
import { PasswordStrengthMeter } from '@/components/password-strength-meter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  addExaminer,
  modOverview,
  requestExaminerRemoval,
  suspendExaminer,
  type ExamStaffAccount,
  type ModOverview,
} from '@/lib/examiners.functions'
import { failureText } from '@/lib/examiners'
import { formatDateTime } from '@/lib/registry'

export function randomPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'
  const digits = '23456789'
  const specials = '!?#%+=@'
  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0]! % set.length]!
  // 12 letters + 2 digits + 2 special characters: always meets the password policy (10+, a digit, a special character).
  const chars = [
    ...Array.from({ length: 12 }, () => pick(alphabet)),
    pick(digits),
    pick(digits),
    pick(specials),
    pick(specials),
  ]
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0]! % (i + 1)
    ;[chars[i], chars[j]] = [chars[j]!, chars[i]!]
  }
  return chars.join('')
}

function Meter({ label, used, max }: { label: string; used: number; max: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, max)) * 100))
  return (
    <Panel>
      <p className="text-sm font-semibold">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">
        {used}
        <span className="text-base font-normal text-muted-foreground"> / {max}</span>
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded bg-muted" aria-hidden>
        <div className={`h-full ${pct >= 100 ? 'bg-rose-600' : pct >= 80 ? 'bg-amber-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
      </div>
    </Panel>
  )
}

const REMOVAL_LABELS = { pending: 'Czeka na decyzję', approved: 'Zaakceptowany', rejected: 'Odrzucony' } as const

/** Moderator of examiners: adds, suspends and asks to remove examiner accounts. */
export function ModeratorView() {
  const [data, setData] = useState<ModOverview | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [custom, setCustom] = useState<Record<string, string>>({})

  const reload = useCallback(async () => {
    try {
      setData(await modOverview())
    } catch {
      toast.error('Nie udało się wczytać panelu moderatora.')
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

  async function add(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await addExaminer({ data: { email, password } })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(`Dodano konto egzaminatora. Przekaż hasło ${email} bezpiecznym kanałem, zmieni je przy pierwszym logowaniu.`)
      setEmail('')
      setPassword('')
      await reload()
    } catch (error) {
      toast.error(failureText(error, 'Nie udało się dodać konta.'))
    } finally {
      setBusy(false)
    }
  }

  async function suspend(account: ExamStaffAccount, hours: number) {
    let reason: string | undefined
    if (hours > 0) {
      const answer = prompt(`Zawiesić konto ${account.email} na ${hours} godz.? Konto zostanie wylogowane.\nPowód (zobaczy go zawieszona osoba):`)
      if (answer === null) return
      reason = answer.trim() || undefined
    }
    try {
      const result = await suspendExaminer({ data: { id: account.id, hours, reason } })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(hours === 0 ? 'Zawieszenie zdjęte.' : 'Konto zawieszone.')
      await reload()
    } catch (error) {
      toast.error(failureText(error, 'Nie udało się zmienić stanu konta.'))
    }
  }

  async function requestRemoval(account: ExamStaffAccount) {
    const reason = prompt(`Powód usunięcia konta ${account.email} (dla administratora):`)
    if (!reason) return
    try {
      const result = await requestExaminerRemoval({ data: { id: account.id, reason } })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Wniosek wysłany do administratora.')
      await reload()
    } catch (error) {
      toast.error(failureText(error, 'Nie udało się wysłać wniosku.'))
    }
  }

  if (!data) return <p className="text-muted-foreground">Wczytywanie…</p>
  const { limits } = data
  const active = data.accounts.filter((a) => !a.suspendedUntil).length

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Meter label="Konta egzaminatorów" used={data.examinerCount} max={limits.maxExaminers} />
        <Meter label="Dodane dziś (24 godz.)" used={data.addedToday} max={limits.addPerDay} />
        <Meter label="Wnioski o usunięcie dziś" used={data.removalsToday} max={limits.removalPerDay} />
      </div>

      <Panel>
        <h2 className="flex items-center gap-2 text-lg font-semibold"><UserPlus className="size-5" /> Dodaj egzaminatora</h2>
        <form onSubmit={add} className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="mod-email">Adres e-mail</Label>
            <Input id="mod-email" type="email" required maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mod-password">Hasło początkowe</Label>
            <div className="flex gap-2">
              <Input id="mod-password" required minLength={10} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
              <Button type="button" variant="outline" onClick={() => setPassword(randomPassword())}>Losuj</Button>
            </div>
            <PasswordStrengthMeter password={password} email={email} />
          </div>
          <Button type="submit" disabled={busy}>{busy ? 'Dodawanie…' : 'Dodaj konto'}</Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">
          Egzaminator musi zmienić hasło przy pierwszym logowaniu. Hasła nie da się później odczytać, więc zapisz je przed dodaniem.
        </p>
      </Panel>

      <Panel>
        <h2 className="text-lg font-semibold">Egzaminatorzy ({data.accounts.length}, aktywnych: {active})</h2>
        {data.accounts.length === 0 ? (
          <p className="mt-4 text-muted-foreground">Nie ma jeszcze żadnych kont egzaminatorów.</p>
        ) : (
          <ul className="mt-4 divide-y">
            {data.accounts.map((a) => (
              <li key={a.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {a.email}{' '}
                      {a.suspendedUntil && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Zawieszony do {formatDateTime(a.suspendedUntil)}</span>}{' '}
                      {a.appeal && <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-900">Odwołanie od zawieszenia</span>}{' '}
                      {a.pendingRemoval && <span className="rounded bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-900">Wniosek o usunięcie</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.suspendReason ? `Powód zawieszenia: ${a.suspendReason} · ` : ''}
                      {a.appeal ? `Odwołanie ${a.appeal.at ? formatDateTime(a.appeal.at) : ''}${a.appeal.message ? `: ${a.appeal.message}` : ''} · ` : ''}
                      Dodano {formatDateTime(a.createdAt)}
                      {a.createdBy ? ` (${a.createdBy})` : ''} · ostatnie logowanie {a.lastLoginAt ? formatDateTime(a.lastLoginAt) : 'brak'} · wnioski 7 dni: {a.requestsWeek} · przyjęte: {a.requestsApproved}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {a.suspendedUntil ? (
                      <Button size="sm" variant="outline" onClick={() => void suspend(a, 0)}><PlayCircle className="size-4" /> Odwieś</Button>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" onClick={() => void suspend(a, 1)}><PauseCircle className="size-4" /> 1 godz.</Button>
                        <Button size="sm" variant="outline" onClick={() => void suspend(a, 24)}>1 dzień</Button>
                        <Button size="sm" variant="outline" onClick={() => void suspend(a, Math.min(168, limits.suspendMaxHours))}>
                          {limits.suspendMaxHours >= 168 ? '7 dni' : `${limits.suspendMaxHours} godz.`}
                        </Button>
                        <Input
                          aria-label={`Własna liczba godzin zawieszenia dla ${a.email}`}
                          className="h-8 w-20"
                          inputMode="numeric"
                          placeholder="godz."
                          value={custom[a.id] ?? ''}
                          onChange={(e) => setCustom({ ...custom, [a.id]: e.target.value.replace(/\D/g, '').slice(0, 3) })}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!custom[a.id]}
                          onClick={() => void suspend(a, Number(custom[a.id]))}
                        >
                          Zawieś
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost" disabled={a.pendingRemoval} onClick={() => void requestRemoval(a)}>
                      <Trash2 className="size-4" /> Wniosek o usunięcie
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Najdłuższe zawieszenie: {limits.suspendMaxHours} godz. Konto usuwa wyłącznie administrator po rozpatrzeniu wniosku.
        </p>
      </Panel>

      <Panel>
        <h2 className="text-lg font-semibold">Moje wnioski o usunięcie ({data.myRemovals.length})</h2>
        {data.myRemovals.length === 0 ? (
          <p className="mt-4 text-muted-foreground">Nie złożono jeszcze żadnego wniosku.</p>
        ) : (
          <ul className="mt-4 divide-y">
            {data.myRemovals.map((r) => (
              <li key={r.id} className="py-3 text-sm">
                <p className="font-medium">{r.targetEmail} · {REMOVAL_LABELS[r.status]}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(r.createdAt)} · powód: {r.reason}
                  {r.note ? ` · uwaga administratora: ${r.note}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
