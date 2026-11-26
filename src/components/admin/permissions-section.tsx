import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  PERMISSIONS,
  PERMISSION_ROLES,
  SOURCE_LABELS,
  exceptionActive,
  resolvePermission,
  roleHasByDefault,
  type PersonException,
  type PersonExceptions,
  type Resolution,
  type RoleDenials,
} from '@/lib/permissions'
import {
  getPermissionOverview,
  previewAccount,
  saveRoleIps,
  saveRolePermissions,
  savePersonPermissions,
  undoPermissionChange,
  type AccountPreview,
  type PermissionAccount,
  type PermissionOverview,
} from '@/lib/permissions.functions'
import { formatDateTime } from '@/lib/registry'

type Tab = 'roles' | 'people' | 'ips' | 'history'
const TABS: { id: Tab; label: string }[] = [
  { id: 'roles', label: 'Role (lista uprawnień)' },
  { id: 'people', label: 'Osoby i wyjątki' },
  { id: 'ips', label: 'Adresy logowania ról' },
  { id: 'history', label: 'Historia zmian' },
]

const roleName = (role: string) => PERMISSION_ROLES.find((r) => r.role === role)?.label ?? role

const CELL: Record<Resolution['source'], { text: string; className: string }> = {
  rola: { text: '✓', className: 'bg-emerald-100 text-emerald-800' },
  wlasciciel: { text: '✓', className: 'bg-emerald-100 text-emerald-800' },
  'wylaczone-w-roli': { text: '✗', className: 'bg-rose-100 text-rose-800' },
  'brak-w-roli': { text: '·', className: 'bg-muted text-muted-foreground' },
  'wyjatek-zablokowane': { text: '✗', className: 'bg-orange-200 text-orange-900 ring-1 ring-orange-500' },
  'wyjatek-dozwolone': { text: '✓', className: 'bg-sky-200 text-sky-900 ring-1 ring-sky-500' },
}

function toLocalInput(iso?: string) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Owner only: switch permissions off for a role or a person (also temporarily), see who can do what, undo changes. */
export function PermissionsSection() {
  const [data, setData] = useState<PermissionOverview | null>(null)
  const [tab, setTab] = useState<Tab>('roles')
  const [draft, setDraft] = useState<RoleDenials>({})
  const [ips, setIps] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      const next = await getPermissionOverview()
      setData(next)
      setDraft(next.denials)
      setIps(next.roleIps)
    } catch {
      toast.error('Nie udało się wczytać uprawnień.')
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

  const changedRoles = useMemo(
    () =>
      data
        ? PERMISSION_ROLES.map((r) => r.role).filter(
            (role) => JSON.stringify([...(draft[role] ?? [])].sort()) !== JSON.stringify([...(data.denials[role] ?? [])].sort()),
          )
        : [],
    [data, draft],
  )

  if (!data) return null

  function toggle(role: string, key: string, enabled: boolean) {
    const current = draft[role] ?? []
    setDraft({ ...draft, [role]: enabled ? current.filter((k) => k !== key) : [...current, key] })
  }

  async function saveRoles() {
    try {
      for (const role of changedRoles) {
        const result = await saveRolePermissions({ data: { role, denied: draft[role] ?? [] } })
        if (!result.ok) {
          toast.error(result.error)
          return
        }
      }
      toast.success('Uprawnienia ról zapisane. Działają od razu.')
      await reload()
    } catch {
      toast.error('Nie udało się zapisać uprawnień.')
    }
  }

  async function saveIps(role: string) {
    try {
      const result = await saveRoleIps({ data: { role, rules: ips[role] ?? '' } })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Adresy zapisane.')
      await reload()
    } catch {
      toast.error('Nie udało się zapisać adresów.')
    }
  }

  async function undo(id: string) {
    try {
      const result = await undoPermissionChange({ data: { id } })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Zmiana cofnięta.')
      await reload()
    } catch {
      toast.error('Nie udało się cofnąć zmiany.')
    }
  }

  const groups = [...new Set(PERMISSIONS.map((p) => p.group))]
  const selectedAccount = data.accounts.find((a) => a.id === selected) ?? null

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div>
        <h3 className="text-sm font-semibold">Uprawnienia: kto co może</h3>
        <p className="text-xs text-muted-foreground">
          Możesz wyłączyć uprawnienie całej roli albo jednej osobie (także na czas). Uprawnienia nie da się nadać roli, która
          go domyślnie nie ma. Twoje konto właściciela nie podlega ograniczeniom.
        </p>
      </div>
      <div role="tablist" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <Button key={t.id} role="tab" aria-selected={tab === t.id} size="sm" variant={tab === t.id ? 'default' : 'outline'} onClick={() => setTab(t.id)}>
            {t.label}
          </Button>
        ))}
      </div>

      {tab === 'roles' && (
        <div className="space-y-3">
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Uprawnienie</th>
                  {PERMISSION_ROLES.map((r) => (
                    <th key={r.role} className="px-3 py-2 text-center">{r.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {groups.map((group) => (
                  <GroupRows key={group} group={group} draft={draft} saved={data.denials} onToggle={toggle} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" disabled={changedRoles.length === 0} onClick={() => void saveRoles()}>Zapisz uprawnienia ról</Button>
            {changedRoles.length > 0 && (
              <>
                <span className="text-xs text-amber-700">Niezapisane zmiany: {changedRoles.map(roleName).join(', ')}</span>
                <Button size="sm" variant="ghost" onClick={() => setDraft(data.denials)}>Odrzuć zmiany</Button>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Pole zaznaczone = rola ma uprawnienie. Odznacz, żeby je wyłączyć. „·” oznacza, że rola nigdy go nie miała.</p>
        </div>
      )}

      {tab === 'people' && (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-md border">
            <table className="text-left text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="sticky left-0 bg-muted px-3 py-2 text-sm">Osoba</th>
                  {PERMISSIONS.map((p) => (
                    <th key={p.key} title={p.label} className="px-1 py-2 align-bottom">
                      <span className="block [writing-mode:vertical-rl] rotate-180 whitespace-nowrap">{p.label}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.accounts.map((account) => (
                  <tr key={account.id} className={account.id === selected ? 'bg-sky-50' : undefined}>
                    <th className="sticky left-0 bg-background px-3 py-1 text-left font-normal">
                      <button type="button" className="text-left text-sm underline-offset-2 hover:underline" onClick={() => setSelected(account.id === selected ? null : account.id)}>
                        {account.email}
                      </button>
                      <span className="block text-[11px] text-muted-foreground">{account.roles.map(roleName).join(', ')}{account.locked ? ' · zablokowane' : ''}</span>
                    </th>
                    {PERMISSIONS.map((p) => {
                      const res = resolvePermission(p.key, { roles: account.roles, isOwner: account.isOwner, denials: data.denials, exceptions: account.exceptions })
                      const cell = CELL[res.source]
                      return (
                        <td key={p.key} className="px-1 py-1 text-center">
                          <span
                            className={`inline-flex size-6 items-center justify-center rounded ${cell.className}`}
                            title={`${p.label}: ${res.allowed ? 'tak' : 'nie'} (${SOURCE_LABELS[res.source]}${res.until ? `, do ${formatDateTime(res.until)}` : ''})`}
                          >
                            {cell.text}
                            {res.until ? <span className="sr-only"> czasowo</span> : null}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            <li><span className="rounded bg-emerald-100 px-1.5 text-emerald-800">✓</span> ma z roli</li>
            <li><span className="rounded bg-rose-100 px-1.5 text-rose-800">✗</span> wyłączone w roli</li>
            <li><span className="rounded bg-orange-200 px-1.5 text-orange-900 ring-1 ring-orange-500">✗</span> zablokowane osobie</li>
            <li><span className="rounded bg-sky-200 px-1.5 text-sky-900 ring-1 ring-sky-500">✓</span> dozwolone osobie (wyjątek)</li>
            <li><span className="rounded bg-muted px-1.5">·</span> rola tego nie ma</li>
          </ul>
          {selectedAccount ? (
            <PersonEditor key={selectedAccount.id} account={selectedAccount} denials={data.denials} onSaved={reload} onClose={() => setSelected(null)} />
          ) : (
            <p className="text-xs text-muted-foreground">Kliknij osobę w tabeli, żeby ustawić jej wyjątki albo zobaczyć podgląd konta.</p>
          )}
        </div>
      )}

      {tab === 'ips' && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Adresy IP (jeden w wierszu, także zakresy CIDR, np. 203.0.113.0/24), z których rola może się logować. Puste pole = bez ograniczeń.
            Dotyczy logowania; Twoje konto właściciela jest zawsze wyjęte spod tej reguły.
          </p>
          {PERMISSION_ROLES.map((r) => (
            <div key={r.role} className="space-y-1">
              <label htmlFor={`ip-${r.role}`} className="text-sm font-medium">{r.label}</label>
              <textarea
                id={`ip-${r.role}`}
                rows={3}
                className="w-full rounded-md border border-input bg-white px-3 py-2 font-mono text-xs"
                value={ips[r.role] ?? ''}
                onChange={(e) => setIps({ ...ips, [r.role]: e.target.value })}
                placeholder="Puste = z dowolnego adresu"
              />
              <Button size="sm" variant="outline" disabled={(ips[r.role] ?? '') === (data.roleIps[r.role] ?? '')} onClick={() => void saveIps(r.role)}>
                Zapisz adresy: {r.label}
              </Button>
            </div>
          ))}
        </div>
      )}

      {tab === 'history' && (
        <div>
          {data.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nie wprowadzono jeszcze żadnych zmian uprawnień.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {data.history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">{h.scope === 'role' ? 'Rola' : 'Osoba'}: {h.targetLabel}{h.undone ? ' (cofnięte)' : ''}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(h.at)} · {h.by}</p>
                    <p className="text-xs">{h.summary}</p>
                  </div>
                  <Button size="sm" variant="outline" disabled={h.undone} onClick={() => void undo(h.id)}>Cofnij</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function GroupRows({
  group,
  draft,
  saved,
  onToggle,
}: {
  group: string
  draft: RoleDenials
  saved: RoleDenials
  onToggle: (role: string, key: string, enabled: boolean) => void
}) {
  return (
    <>
      <tr className="bg-muted/30">
        <td colSpan={PERMISSION_ROLES.length + 1} className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</td>
      </tr>
      {PERMISSIONS.filter((p) => p.group === group).map((p) => (
        <tr key={p.key}>
          <td className="px-3 py-2">{p.label}</td>
          {PERMISSION_ROLES.map((r) => {
            if (!roleHasByDefault(r.role, p.key)) {
              return <td key={r.role} className="px-3 py-2 text-center text-muted-foreground">·</td>
            }
            const enabled = !(draft[r.role] ?? []).includes(p.key)
            const was = !(saved[r.role] ?? []).includes(p.key)
            return (
              <td key={r.role} className={`px-3 py-2 text-center ${enabled !== was ? 'bg-amber-50' : ''}`}>
                <input
                  type="checkbox"
                  checked={enabled}
                  aria-label={`${p.label}: ${r.label}`}
                  onChange={(e) => onToggle(r.role, p.key, e.target.checked)}
                />
              </td>
            )
          })}
        </tr>
      ))}
    </>
  )
}

type Choice = 'inherit' | 'deny' | 'allow'

/** One person: exceptions (blocked / allowed, forever or until a date) and a read-only preview of the account. */
function PersonEditor({
  account,
  denials,
  onSaved,
  onClose,
}: {
  account: PermissionAccount
  denials: RoleDenials
  onSaved: () => Promise<void>
  onClose: () => void
}) {
  const relevant = PERMISSIONS.filter((p) => account.roles.some((role) => roleHasByDefault(role, p.key)))
  const [choices, setChoices] = useState<Record<string, Choice>>(() =>
    Object.fromEntries(
      relevant.map((p) => {
        const e = account.exceptions[p.key]
        return [p.key, exceptionActive(e) ? (e.mode === 'deny' ? 'deny' : 'allow') : 'inherit']
      }),
    ),
  )
  const [until, setUntil] = useState<Record<string, string>>(() =>
    Object.fromEntries(relevant.map((p) => [p.key, exceptionActive(account.exceptions[p.key]) ? toLocalInput(account.exceptions[p.key]?.until) : ''])),
  )
  const [preview, setPreview] = useState<AccountPreview | null>(null)
  const [busy, setBusy] = useState(false)

  async function save(clear: boolean) {
    const exceptions: PersonExceptions = {}
    if (!clear) {
      for (const p of relevant) {
        const choice = choices[p.key]
        if (choice === 'inherit') continue
        const item: PersonException = { mode: choice }
        if (until[p.key]) item.until = new Date(until[p.key]).toISOString()
        exceptions[p.key] = item
      }
    }
    setBusy(true)
    try {
      const result = await savePersonPermissions({ data: { id: account.id, exceptions } })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(clear ? 'Wyjątki usunięte.' : 'Wyjątki zapisane. Działają od razu.')
      await onSaved()
    } catch {
      toast.error('Nie udało się zapisać wyjątków.')
    } finally {
      setBusy(false)
    }
  }

  async function showPreview() {
    try {
      setPreview(await previewAccount({ data: { id: account.id } }))
    } catch {
      toast.error('Nie udało się wczytać podglądu.')
    }
  }

  if (account.isOwner) {
    return (
      <div className="rounded-md border p-3 text-sm">
        Konto właściciela ({account.email}) nie podlega ograniczeniom.{' '}
        <Button size="sm" variant="ghost" onClick={onClose}>Zamknij</Button>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Wyjątki dla: {account.email}</h4>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void showPreview()}>Podgląd konta</Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Zamknij</Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr><th className="py-1 pr-3">Uprawnienie</th><th className="py-1 pr-3">Dla tej osoby</th><th className="py-1">Do (puste = bez końca)</th></tr>
          </thead>
          <tbody className="divide-y">
            {relevant.map((p) => {
              const role = resolvePermission(p.key, { roles: account.roles, isOwner: false, denials, exceptions: {} })
              return (
                <tr key={p.key}>
                  <td className="py-1.5 pr-3">{p.label} <span className="text-xs text-muted-foreground">(rola: {role.allowed ? 'ma' : 'wyłączone'})</span></td>
                  <td className="py-1.5 pr-3">
                    <select
                      aria-label={`${p.label}: wyjątek`}
                      className="h-8 rounded-md border border-input bg-white px-2 text-sm"
                      value={choices[p.key]}
                      onChange={(e) => setChoices({ ...choices, [p.key]: e.target.value as Choice })}
                    >
                      <option value="inherit">Jak w roli</option>
                      <option value="deny">Zablokuj</option>
                      <option value="allow">Zezwól (mimo wyłączenia w roli)</option>
                    </select>
                  </td>
                  <td className="py-1.5">
                    <input
                      type="datetime-local"
                      aria-label={`${p.label}: do kiedy`}
                      disabled={choices[p.key] === 'inherit'}
                      className="h-8 rounded-md border border-input bg-white px-2 text-sm disabled:opacity-40"
                      value={until[p.key]}
                      onChange={(e) => setUntil({ ...until, [p.key]: e.target.value })}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => void save(false)}>Zapisz wyjątki</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void save(true)}>Usuń wszystkie wyjątki</Button>
      </div>
      {preview && (
        <div className="space-y-2 rounded-md border bg-background p-3 text-sm">
          <p className="font-semibold">Podgląd konta {preview.email} (tylko do odczytu, nie logujesz się jako ta osoba)</p>
          <p className="text-xs text-muted-foreground">
            Role: {preview.roles.map(roleName).join(', ')} · ostatnie logowanie: {preview.lastLoginAt ? formatDateTime(preview.lastLoginAt) : 'brak'}
            {preview.locked ? ` · konto zablokowane${preview.lockedReason ? ` (${preview.lockedReason})` : ''}` : ''}
            {preview.suspendedUntil ? ` · zawieszone do ${formatDateTime(preview.suspendedUntil)}` : ''}
            {preview.mustChangePassword ? ' · musi zmienić hasło' : ''}
            {preview.ipRules ? ` · logowanie tylko z: ${preview.ipRules.split('\n').join(', ')}` : ''}
          </p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {preview.permissions.map((p) => (
              <li key={p.key} className="flex items-center gap-2 text-xs">
                <span className={`inline-flex size-5 items-center justify-center rounded ${CELL[p.source].className}`}>{CELL[p.source].text}</span>
                <span>{p.label} <span className="text-muted-foreground">({SOURCE_LABELS[p.source]}{p.until ? `, do ${formatDateTime(p.until)}` : ''})</span></span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
