import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Check, Trash2, UserPlus, X } from 'lucide-react'
import { toast } from 'sonner'

import { Panel } from '@/components/admin/panel'
import { ExamStaffEditor } from '@/components/examiners/exam-staff-editor'
import { randomPassword } from '@/components/examiners/moderator-view'
import { PasswordStrengthMeter } from '@/components/password-strength-meter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  addExamStaff,
  adminExamStaff,
  decideRemoval,
  deleteExamStaff,
  setExaminerOverride,
  type AdminExamStaff,
  type ExamStaffAccount,
} from '@/lib/examiners.functions'
import { formatDateTime } from '@/lib/registry'

/** Admin: examiner and moderator accounts and the moderators' requests to remove an account. */
const OVERRIDE_FIELDS = [
  { key: 'requestsCount', label: 'Wnioski w oknie', min: 1, max: 50 },
  { key: 'requestsWindowMinutes', label: 'Okno (min)', min: 1, max: 1440 },
  { key: 'pendingMax', label: 'Oczekujące naraz', min: 1, max: 200 },
] as const

/** An exception to the general limits for one person. */
function OverrideEditor({ account, onSaved }: { account: ExamStaffAccount; onSaved: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(OVERRIDE_FIELDS.map((f) => [f.key, String(account.override?.[f.key] ?? '')])),
  )
  async function save(clear: boolean) {
    const override = clear
      ? null
      : Object.fromEntries(OVERRIDE_FIELDS.filter((f) => values[f.key]).map((f) => [f.key, Number(values[f.key])]))
    try {
      const result = await setExaminerOverride({ data: { id: account.id, override } })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(clear ? 'Wyjątek usunięty, obowiązują limity ogólne.' : 'Limity dla tej osoby zapisane.')
      onSaved()
    } catch {
      toast.error('Nie udało się zapisać limitów.')
    }
  }
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-2">
      {OVERRIDE_FIELDS.map((f) => (
        <label key={f.key} className="text-xs">
          {f.label}
          <input
            type="number"
            min={f.min}
            max={f.max}
            placeholder="ogólny"
            value={values[f.key]}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            className="mt-1 block h-8 w-24 rounded-md border border-input bg-white px-2 text-sm"
          />
        </label>
      ))}
      <Button size="sm" onClick={() => void save(false)}>Zapisz</Button>
      <Button size="sm" variant="outline" onClick={() => void save(true)}>Przywróć ogólne</Button>
      <p className="w-full text-xs text-muted-foreground">Puste pole = obowiązuje limit ogólny.</p>
    </div>
  )
}

export function ExamStaffAdmin({ onChanged }: { onChanged?: () => void }) {
  const [limitsFor, setLimitsFor] = useState<string | null>(null)
  const [editFor, setEditFor] = useState<string | null>(null)
  const [data, setData] = useState<AdminExamStaff | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'examiner' | 'moderator'>('moderator')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      setData(await adminExamStaff())
    } catch {
      toast.error('Nie udało się wczytać kont egzaminatorów.')
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

  async function add(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await addExamStaff({ data: { email, password, role } })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Konto utworzone. Przekaż hasło bezpiecznym kanałem, zostanie zmienione przy pierwszym logowaniu.')
      setEmail('')
      setPassword('')
      await reload()
      onChanged?.()
    } catch {
      toast.error('Nie udało się utworzyć konta.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string, label: string) {
    if (!confirm(`Usunąć konto ${label} na stałe?`)) return
    try {
      const result = await deleteExamStaff({ data: { id } })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Konto usunięte.')
      await reload()
      onChanged?.()
    } catch {
      toast.error('Nie udało się usunąć konta.')
    }
  }

  async function decide(id: number, decision: 'approve' | 'reject') {
    let note: string | undefined
    if (decision === 'reject') note = prompt('Uwaga dla moderatora (opcjonalnie):') ?? undefined
    else if (!confirm('Zaakceptować wniosek? Konto zostanie usunięte na stałe.')) return
    try {
      const result = await decideRemoval({ data: { id, decision, note } })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(decision === 'approve' ? 'Konto usunięte.' : 'Wniosek odrzucony.')
      await reload()
      onChanged?.()
    } catch {
      toast.error('Nie udało się rozpatrzyć wniosku.')
    }
  }

  if (!data) return <Panel><p className="text-muted-foreground">Wczytywanie…</p></Panel>
  const pending = data.removals.filter((r) => r.status === 'pending')
  const decided = data.removals.filter((r) => r.status !== 'pending').slice(0, 10)
  const selectClass = 'h-9 rounded-md border border-input bg-white px-3 text-sm'

  return (
    <div className="space-y-6">
      <Panel>
        <h2 className="text-lg font-semibold">Wnioski o usunięcie kont egzaminatorów ({pending.length})</h2>
        {pending.length === 0 ? (
          <p className="mt-4 text-muted-foreground">Brak wniosków do rozpatrzenia.</p>
        ) : (
          <ul className="mt-4 divide-y">
            {pending.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
                <div className="text-sm">
                  <p className="font-medium">{r.targetEmail}</p>
                  <p className="text-xs text-muted-foreground">Wniosek moderatora {r.requestedBy}, {formatDateTime(r.createdAt)}</p>
                  <p className="mt-1">Powód: {r.reason}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void decide(r.id, 'approve')}><Check className="size-4" /> Usuń konto</Button>
                  <Button size="sm" variant="outline" onClick={() => void decide(r.id, 'reject')}><X className="size-4" /> Odrzuć</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {decided.length > 0 && (
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-muted-foreground">Ostatnie decyzje ({decided.length})</summary>
            <ul className="mt-2 space-y-1">
              {decided.map((r) => (
                <li key={r.id} className="text-xs text-muted-foreground">
                  {r.targetEmail}: {r.status === 'approved' ? 'usunięto' : 'odrzucono'} {r.decidedAt ? formatDateTime(r.decidedAt) : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Panel>

      <Panel>
        <h2 className="flex items-center gap-2 text-lg font-semibold"><UserPlus className="size-5" /> Dodaj egzaminatora lub moderatora</h2>
        <form onSubmit={add} className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="adm-ex-email">Adres e-mail</Label>
            <Input id="adm-ex-email" type="email" required maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adm-ex-password">Hasło początkowe</Label>
            <div className="flex gap-2">
              <Input id="adm-ex-password" required minLength={10} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
              <Button type="button" variant="outline" onClick={() => setPassword(randomPassword())}>Losuj</Button>
            </div>
            <PasswordStrengthMeter password={password} email={email} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="adm-ex-role">Rola</Label>
            <select id="adm-ex-role" value={role} onChange={(e) => setRole(e.target.value as 'examiner' | 'moderator')} className={selectClass}>
              <option value="moderator">Moderator egzaminatorów</option>
              <option value="examiner">Egzaminator</option>
            </select>
          </div>
          <Button type="submit" disabled={busy}>{busy ? 'Dodawanie…' : 'Dodaj'}</Button>
        </form>
      </Panel>

      <Panel>
        <h2 className="text-lg font-semibold">Konta ({data.accounts.length})</h2>
        {data.accounts.length === 0 ? (
          <p className="mt-4 text-muted-foreground">Brak kont egzaminatorów i moderatorów.</p>
        ) : (
          <ul className="mt-4 divide-y">
            {data.accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="text-sm">
                  <p className="font-medium">
                    {a.email}{' '}
                    <span className="rounded bg-muted px-2 py-0.5 text-xs">{a.role === 'moderator' ? 'moderator' : 'egzaminator'}</span>{' '}
                    {a.suspendedUntil && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Zawieszony do {formatDateTime(a.suspendedUntil)}</span>}{' '}
                    {a.appeal && <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-900">Odwołanie od zawieszenia</span>}{' '}
                    {a.locked && <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-900">Zablokowane</span>}{' '}
                    {a.override && <span className="rounded bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-900">Własne limity</span>}
                  </p>
                  {a.suspendReason && <p className="text-xs text-muted-foreground">Powód zawieszenia: {a.suspendReason}</p>}
                  <p className="text-xs text-muted-foreground">
                    Dodano {formatDateTime(a.createdAt)}{a.createdBy ? ` (${a.createdBy})` : ''} · logowanie {a.lastLoginAt ? formatDateTime(a.lastLoginAt) : 'brak'}
                    {a.role === 'examiner' ? ` · wnioski 7 dni: ${a.requestsWeek}, przyjęte: ${a.requestsApproved}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant={editFor === a.id ? 'default' : 'outline'} onClick={() => setEditFor(editFor === a.id ? null : a.id)}>Edytuj</Button>
                  <Button size="sm" variant="outline" onClick={() => setLimitsFor(limitsFor === a.id ? null : a.id)}>Limity</Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(a.id, a.email)}><Trash2 className="size-4" /> Usuń</Button>
                </div>
                {editFor === a.id && (
                  <div className="w-full">
                    <ExamStaffEditor
                      account={a}
                      onChanged={() => {
                        void reload()
                        onChanged?.()
                      }}
                    />
                  </div>
                )}
                {limitsFor === a.id && (
                  <div className="w-full">
                    <OverrideEditor account={a} onSaved={() => void reload()} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
