import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Panel } from '@/components/admin/panel'
import { Button } from '@/components/ui/button'
import { APPROVAL_ACTIONS } from '@/lib/approvals'
import {
  approveRequest,
  cancelRequest,
  listApprovalRequests,
  rejectRequest,
  type ApprovalRow,
} from '@/lib/approvals.functions'
import { formatDateTime } from '@/lib/registry'

const STATUS_NAMES: Record<string, string> = {
  pending: 'czeka na zgody',
  approved: 'zatwierdzony. Autor może teraz powtórzyć akcję',
  rejected: 'odrzucony',
  used: 'wykonany',
  cancelled: 'wycofany',
}

/** Two-person rule: requests of other admins to approve, and the admin's own requests. */
export function ApprovalsPanel({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<ApprovalRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    void listApprovalRequests().then(setRows).catch(() => setRows([]))
  }, [])
  useEffect(load, [load])

  async function act(id: string, kind: 'approve' | 'reject' | 'cancel') {
    setBusy(id)
    try {
      const fn = kind === 'approve' ? approveRequest : kind === 'reject' ? rejectRequest : cancelRequest
      const result = await fn({ data: { id } })
      if (!result.ok) toast.error(result.error)
      else toast.success(kind === 'approve' ? 'Zatwierdzono.' : kind === 'reject' ? 'Odrzucono.' : 'Wycofano.')
      load()
      onChanged?.()
    } catch {
      toast.error('Nie udało się zapisać decyzji.')
    } finally {
      setBusy(null)
    }
  }

  const visible = (rows ?? []).filter((r) => r.status !== 'used' && r.status !== 'cancelled' && r.status !== 'rejected' || r.mine)
  if (rows && visible.length === 0) return null

  return (
    <Panel>
      <h3 className="mb-1 text-base font-semibold">Zgody adminów (zasada dwóch osób)</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Wrażliwe akcje innych adminów czekają tu na Twoją decyzję. Własnego wniosku nie możesz zatwierdzić.
      </p>
      <ul className="space-y-2">
        {visible.map((r) => (
          <li key={r.id} className="rounded-md border p-3 text-sm">
            <div className="font-medium">{r.summary}</div>
            <div className="text-xs text-muted-foreground">
              {APPROVAL_ACTIONS.find((a) => a.key === r.action)?.label} · {r.mine ? 'Twój wniosek' : r.requestedBy} ·{' '}
              {formatDateTime(r.createdAt)} · zgody {r.approvals.length}/{r.required} · {STATUS_NAMES[r.status]}
              {r.approvals.length > 0 && ` (${r.approvals.map((a) => a.by).join(', ')})`}
            </div>
            <div className="mt-2 flex gap-2">
              {r.canDecide && (
                <>
                  <Button size="sm" disabled={busy === r.id} onClick={() => void act(r.id, 'approve')}>
                    Zatwierdź
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => void act(r.id, 'reject')}>
                    Odrzuć
                  </Button>
                </>
              )}
              {r.mine && (r.status === 'pending' || r.status === 'approved') && (
                <Button size="sm" variant="outline" disabled={busy === r.id} onClick={() => void act(r.id, 'cancel')}>
                  Wycofaj
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
