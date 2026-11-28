import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { COMBINABLE_ROLES, COMBINABLE_ROLE_LABELS } from '@/lib/registry'
import { setAccountRoles } from '@/lib/registry.functions'

/**
 * Admin: which of kierownictwo / egzaminator / moderator egzaminatorów one account has. One person may have
 * several of them (e.g. kierownictwo and moderator). An admin account can never be combined with these roles.
 */
export function AccountRolesEditor({
  account,
  onChanged,
}: {
  account: { id: string; email: string; roles: string[] }
  onChanged: () => void
}) {
  const [roles, setRoles] = useState<string[]>(account.roles.filter((r) => (COMBINABLE_ROLES as readonly string[]).includes(r)))
  const [busy, setBusy] = useState(false)
  const unchanged =
    roles.length === account.roles.length && roles.every((role) => account.roles.includes(role))

  function toggle(role: string, on: boolean) {
    setRoles(on ? [...new Set([...roles, role])] : roles.filter((r) => r !== role))
  }

  async function save() {
    setBusy(true)
    try {
      const result = await setAccountRoles({
        data: { id: account.id, roles: roles as (typeof COMBINABLE_ROLES)[number][] },
      })
      if (result.ok) {
        toast.success('Role zapisane. Osoba została wylogowana i zaloguje się z nowym zestawem ról.')
        onChanged()
      } else toast.error(result.error)
    } catch {
      toast.error('Nie udało się zapisać ról (potrzebne uprawnienia do kont kierownictwa i egzaminatorów).')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
      <p className="font-semibold">Role konta {account.email}</p>
      <p className="text-xs text-muted-foreground">
        Jedna osoba może mieć kilka z tych ról naraz (np. kierownictwo i moderator egzaminatorów). Z rolą administratora
        nie da się ich łączyć.
      </p>
      <div className="flex flex-wrap gap-4">
        {COMBINABLE_ROLES.map((role) => (
          <label key={role} className="flex items-center gap-2">
            <input type="checkbox" checked={roles.includes(role)} onChange={(e) => toggle(role, e.target.checked)} />
            {COMBINABLE_ROLE_LABELS[role]}
          </label>
        ))}
      </div>
      <Button size="sm" disabled={busy || unchanged || roles.length === 0} onClick={() => void save()}>
        Zapisz role
      </Button>
    </div>
  )
}
