import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { ReasonTemplates } from '@/components/admin/reason-templates'
import { AccountRolesEditor } from '@/components/admin/account-roles-editor'
import { randomPassword } from '@/components/examiners/moderator-view'
import { PasswordStrengthMeter } from '@/components/password-strength-meter'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  examStaffPermissions,
  saveExamStaffPermissions,
  setExamStaffLocked,
  setExamStaffPassword,
  setExamStaffRole,
  suspendExamStaff,
  type ExamStaffAccount,
  type ExamStaffPermissionView,
} from '@/lib/examiners.functions'
import { SOURCE_LABELS } from '@/lib/permissions'
import { PASSWORD_RULES_ERROR, PASSWORD_RULES_TEXT, meetsPasswordPolicy } from '@/lib/password-strength'

type Mode = 'default' | 'deny' | 'allow'
type Draft = Record<string, { mode: Mode; until: string }>

const selectClass = 'h-8 rounded-md border border-input bg-white px-2 text-sm'

/** Admin: edit one examiner / moderator account (role, password, suspension, block) and their personal permissions. */
export function ExamStaffEditor({ account, onChanged }: { account: ExamStaffAccount; onChanged: () => void }) {
  const [role, setRole] = useState<'examiner' | 'moderator'>(account.role)
  const [password, setPassword] = useState('')
  const [hours, setHours] = useState('24')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<ExamStaffPermissionView | null>(null)
  const [draft, setDraft] = useState<Draft>({})

  const loadPermissions = useCallback(async () => {
    try {
      const loaded = await examStaffPermissions({ data: { id: account.id } })
      setView(loaded)
      setDraft(
        Object.fromEntries(
          Object.entries(loaded?.exceptions ?? {}).map(([key, item]) => [
            key,
            { mode: item.mode, until: item.until ? item.until.slice(0, 10) : '' },
          ]),
        ),
      )
    } catch {
      toast.error('Nie udało się wczytać uprawnień tego konta.')
    }
  }, [account.id])

  useEffect(() => {
    void loadPermissions()
  }, [loadPermissions])

  async function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    setBusy(true)
    try {
      const result = await action()
      if (!result.ok) {
        toast.error(result.error)
        return false
      }
      toast.success(success)
      onChanged()
      return true
    } catch {
      toast.error('Nie udało się zapisać zmiany.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function savePermissions() {
    const exceptions: Record<string, { mode: 'allow' | 'deny'; until?: string }> = {}
    for (const [key, item] of Object.entries(draft)) {
      if (item.mode === 'default') continue
      exceptions[key] = {
        mode: item.mode,
        ...(item.until ? { until: new Date(`${item.until}T23:59:59`).toISOString() } : {}),
      }
    }
    if (await run(() => saveExamStaffPermissions({ data: { id: account.id, exceptions } }), 'Uprawnienia zapisane.')) {
      await loadPermissions()
    }
  }

  function submitPassword() {
    if (!meetsPasswordPolicy(password)) {
      toast.error(PASSWORD_RULES_ERROR)
      return
    }
    void run(async () => {
      const result = await setExamStaffPassword({ data: { id: account.id, password } })
      if (result.ok) setPassword('')
      return result
    }, 'Hasło ustawione. Przekaż je bezpiecznym kanałem, osoba zmieni je przy logowaniu.')
  }

  const groups = [...new Set(view?.permissions.map((p) => p.group) ?? [])]

  return (
    <div className="space-y-5 rounded-md border bg-muted/30 p-3 text-sm">
      <section className="space-y-2">
        <h3 className="font-semibold">Konto</h3>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            Rola
            <select value={role} onChange={(e) => setRole(e.target.value as 'examiner' | 'moderator')} className={selectClass}>
              <option value="examiner">Egzaminator</option>
              <option value="moderator">Moderator egzaminatorów</option>
            </select>
          </label>
          <Button
            size="sm"
            disabled={busy || role === account.role}
            onClick={() =>
              void run(
                () => setExamStaffRole({ data: { id: account.id, role } }),
                'Rola zmieniona. Osoba została wylogowana i zaloguje się już z nową rolą.',
              )
            }
          >
            Zmień rolę
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  setExamStaffLocked({
                    data: { id: account.id, locked: !account.locked, reason: account.locked ? undefined : reason || undefined },
                  }),
                account.locked ? 'Konto odblokowane.' : 'Konto zablokowane i wylogowane.',
              )
            }
          >
            {account.locked ? 'Odblokuj konto' : 'Zablokuj konto'}
          </Button>
        </div>
      </section>

      <AccountRolesEditor account={account} onChanged={onChanged} />

      <section className="space-y-2">
        <h3 className="font-semibold">Nowe hasło</h3>
        <div className="flex flex-wrap items-start gap-2">
          <div className="space-y-1">
            <Input
              aria-label="Nowe hasło"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={200}
              className="h-8 w-64 font-mono"
              placeholder="Nowe hasło"
            />
            <PasswordStrengthMeter password={password} email={account.email} />
            <p className="text-xs text-muted-foreground">{PASSWORD_RULES_TEXT}</p>
          </div>
          <Button size="sm" variant="outline" type="button" onClick={() => setPassword(randomPassword())}>Losuj</Button>
          <Button size="sm" disabled={busy || !password} onClick={submitPassword}>Ustaw hasło</Button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Zawieszenie</h3>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            Godziny
            <Input type="number" min={1} max={8760} value={hours} onChange={(e) => setHours(e.target.value)} className="h-8 w-24" />
          </label>
          <Input aria-label="Powód" placeholder="Powód (widoczny dla osoby)" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 w-64" />
          <div className="w-full"><ReasonTemplates category="suspend" onPick={setReason} maxLength={300} /></div>
          <Button
            size="sm"
            disabled={busy || !(Number(hours) >= 1)}
            onClick={() =>
              void run(
                () => suspendExamStaff({ data: { id: account.id, hours: Math.floor(Number(hours)), reason: reason || undefined } }),
                'Konto zawieszone.',
              )
            }
          >
            Zawieś
          </Button>
          {account.suspendedUntil && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => suspendExamStaff({ data: { id: account.id, hours: 0 } }), 'Zawieszenie zdjęte.')}
            >
              Zdejmij zawieszenie
            </Button>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-semibold">Uprawnienia tej osoby</h3>
        <p className="text-xs text-muted-foreground">
          Domyślnie obowiązują uprawnienia roli. Tu możesz jednej osobie coś zablokować (też do wybranej daty) albo
          przywrócić, gdy właściciel wyłączył to całej roli. Uprawnień spoza roli nie da się nadać.
        </p>
        {!view ? (
          <p className="text-muted-foreground">Wczytywanie…</p>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <div key={group}>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
                <ul className="divide-y">
                  {view.permissions
                    .filter((p) => p.group === group)
                    .map((p) => {
                      const item = draft[p.key] ?? { mode: 'default' as Mode, until: '' }
                      return (
                        <li key={p.key} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                          <span>
                            {p.label}{' '}
                            <span className={`rounded px-1.5 py-0.5 text-xs ${p.allowed ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}>
                              {p.allowed ? 'ma' : 'nie ma'} ({SOURCE_LABELS[p.source]})
                            </span>
                          </span>
                          <span className="flex items-center gap-2">
                            <select
                              aria-label={`Uprawnienie: ${p.label}`}
                              value={item.mode}
                              onChange={(e) => setDraft({ ...draft, [p.key]: { ...item, mode: e.target.value as Mode } })}
                              className={selectClass}
                            >
                              <option value="default">Zgodnie z rolą</option>
                              <option value="deny">Zablokuj tej osobie</option>
                              <option value="allow">Zezwól tej osobie</option>
                            </select>
                            {item.mode !== 'default' && (
                              <label className="flex items-center gap-1 text-xs">
                                do
                                <input
                                  type="date"
                                  value={item.until}
                                  min={new Date().toISOString().slice(0, 10)}
                                  onChange={(e) => setDraft({ ...draft, [p.key]: { ...item, until: e.target.value } })}
                                  className="h-8 rounded-md border border-input bg-white px-2 text-sm"
                                />
                              </label>
                            )}
                          </span>
                        </li>
                      )
                    })}
                </ul>
              </div>
            ))}
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => void savePermissions()}>Zapisz uprawnienia</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setDraft({})}>Wyczyść wyjątki</Button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
