import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { MAX_REQUIRED_APPROVALS, type ApprovalPolicy } from '@/lib/approvals'
import { getApprovalPolicy, saveApprovalPolicy, type ApprovalSettings } from '@/lib/approvals.functions'

/** Owner: which sensitive actions need approvals of other admins, how many, and who is exempt. */
export function ApprovalPolicySection() {
  const [data, setData] = useState<ApprovalSettings | null>(null)
  const [policy, setPolicy] = useState<ApprovalPolicy | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void getApprovalPolicy()
      .then((d) => {
        setData(d)
        setPolicy(d.policy)
      })
      .catch(() => toast.error('Nie udało się wczytać zasad zgód.'))
  }, [])

  if (!data || !policy) return null

  function toggleExempt(email: string) {
    setPolicy((p) =>
      p && { ...p, exemptEmails: p.exemptEmails.includes(email) ? p.exemptEmails.filter((e) => e !== email) : [...p.exemptEmails, email] },
    )
  }

  async function save() {
    if (!policy) return
    setBusy(true)
    try {
      await saveApprovalPolicy({ data: policy })
      toast.success('Zapisano zasady zgód.')
    } catch {
      toast.error('Nie udało się zapisać.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-4">
      <h3 className="text-sm font-semibold">Zasada dwóch osób (zgody adminów)</h3>
      <p className="text-xs text-muted-foreground">
        Dla każdej akcji wybierz, ilu innych adminów musi ją zatwierdzić, zanim admin ją wykona (0 = bez zgód). Ty i
        współwłaściciele oraz wyznaczeni niżej admini działacie bez zgód. Wniosek wygasa po wybranym czasie, a zatwierdzoną akcję
        autor wykonuje jednorazowo, powtarzając ją.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {data.actions.map((a) => (
          <label key={a.key} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
            <span>{a.label}</span>
            <select
              className="h-8 rounded-md border border-input bg-white px-2"
              value={policy.rules[a.key as keyof typeof policy.rules] ?? 0}
              onChange={(e) =>
                setPolicy({ ...policy, rules: { ...policy.rules, [a.key]: Number(e.target.value) } })
              }
            >
              {Array.from({ length: MAX_REQUIRED_APPROVALS + 1 }, (_, n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'bez zgód' : `${n} ${n === 1 ? 'zgoda' : 'zgody'}`}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        Ważność wniosku (godziny):
        <input
          type="number"
          min={1}
          max={168}
          value={policy.validHours}
          onChange={(e) => setPolicy({ ...policy, validHours: Math.max(1, Math.min(168, Number(e.target.value) || 24)) })}
          className="h-8 w-20 rounded-md border border-input bg-white px-2"
        />
      </label>
      <div>
        <div className="mb-1 text-sm font-medium">Admini działający bez zgód</div>
        {data.admins.length === 0 ? (
          <p className="text-xs text-muted-foreground">Brak innych adminów.</p>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {data.admins.map((email) => (
              <label key={email} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={policy.exemptEmails.includes(email)} onChange={() => toggleExempt(email)} />
                {email}
              </label>
            ))}
          </div>
        )}
      </div>
      <Button size="sm" disabled={busy} onClick={() => void save()}>
        Zapisz zasady
      </Button>
    </div>
  )
}
