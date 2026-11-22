import { useCallback, useEffect, useState } from 'react'
import { EmptyState } from '@/components/empty-state'
import { CalendarClock, Check, X } from 'lucide-react'
import { toast } from 'sonner'

import { Panel } from '@/components/admin/panel'
import { RequestStatusBadge } from '@/components/admin/requests-panels'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  decideExpiryRequest,
  getExpiryRequestProof,
  listExpiryRequests,
  listMyExpiryRequests,
  type ExpiryRequestRow,
} from '@/lib/expiry-requests.functions'
import { formatDateTime } from '@/lib/registry'

/** kierownictwo: their own requests to change a PWZ validity. */
export function MyExpiryRequestsPanel() {
  const [rows, setRows] = useState<ExpiryRequestRow[] | null>(null)

  useEffect(() => {
    let active = true
    listMyExpiryRequests()
      .then((result) => {
        if (active) setRows(result)
      })
      .catch(() => {
        if (active) setRows([])
      })
    return () => {
      active = false
    }
  }, [])

  if (rows !== null && rows.length === 0) return null
  return (
    <Panel>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <CalendarClock className="size-5" /> Moje wnioski o zmianę terminu
      </h2>
      {rows === null ? (
        <p className="mt-4 text-muted-foreground">Wczytywanie…</p>
      ) : (
        <ul className="mt-4 divide-y">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <div>
                <p className="font-medium">
                  {row.personName}{' '}
                  <span className="font-mono text-xs font-normal text-muted-foreground">
                    PWZ {row.pwz}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {row.wanted} · złożono {formatDateTime(row.createdAt)}
                  {row.decidedAt ? ` · decyzja ${formatDateTime(row.decidedAt)}` : ''}
                </p>
                {row.note && (
                  <p className="mt-1 text-sm">Uwaga administratora: {row.note}</p>
                )}
              </div>
              <RequestStatusBadge status={row.status} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** Admin: requests to change a PWZ validity, with the screenshot. */
export function ExpiryRequestsPanel({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<ExpiryRequestRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [viewing, setViewing] = useState<ExpiryRequestRow | null>(null)
  const [proof, setProof] = useState<string | null>(null)
  const [proofError, setProofError] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [rejecting, setRejecting] = useState<ExpiryRequestRow | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setRows(await listExpiryRequests())
    } catch {
      setFailed(true)
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function openProof(row: ExpiryRequestRow) {
    setViewing(row)
    setProof(null)
    setProofError(false)
    try {
      const result = await getExpiryRequestProof({ data: { id: row.id } })
      if (result.proof) setProof(result.proof)
      else setProofError(true)
    } catch {
      setProofError(true)
    }
  }

  async function decide(row: ExpiryRequestRow, decision: 'approve' | 'reject', note?: string) {
    setBusyId(row.id)
    try {
      const result = await decideExpiryRequest({ data: { id: row.id, decision, note } })
      if (!result.ok) {
        toast.error(result.error)
        await load()
        return
      }
      toast.success(
        decision === 'approve' ? 'Zmieniono termin ważności PWZ.' : 'Wniosek odrzucony.',
      )
      setRejecting(null)
      setReason('')
      await load()
      onChanged()
    } catch {
      toast.error('Nie udało się zapisać decyzji.')
    } finally {
      setBusyId(null)
    }
  }

  const pending = rows?.filter((r) => r.status === 'pending') ?? []
  const decided = rows?.filter((r) => r.status !== 'pending') ?? []

  return (
    <Panel>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <CalendarClock className="size-5" /> Wnioski o zmianę terminu PWZ
        {rows && !failed ? ` (oczekujące: ${pending.length})` : ''}
      </h2>
      {rows === null ? (
        <p className="mt-4 text-muted-foreground">Wczytywanie…</p>
      ) : failed ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          Nie udało się wczytać wniosków.
        </p>
      ) : (
        <>
          {pending.length === 0 ? (
            <EmptyState kind="inbox">Brak wniosków oczekujących na decyzję.</EmptyState>
          ) : (
            <ul className="mt-4 divide-y rounded-md border">
              {pending.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {row.personName}{' '}
                      <span className="font-mono text-xs font-normal text-muted-foreground">
                        PWZ {row.pwz}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Chce: {row.wanted} · od {row.requestedBy} · {formatDateTime(row.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => void openProof(row)}>
                      Zobacz zrzut ekranu
                    </Button>
                    <Button
                      size="sm"
                      disabled={busyId === row.id}
                      onClick={() => void decide(row, 'approve')}
                    >
                      <Check className="size-4" /> Akceptuj
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === row.id}
                      onClick={() => {
                        setRejecting(row)
                        setReason('')
                      }}
                    >
                      <X className="size-4" /> Odrzuć
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {decided.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold">
                Historia decyzji ({decided.length})
              </summary>
              <ul className="mt-2 divide-y">
                {decided.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm"
                  >
                    <div>
                      <p>
                        {row.personName}{' '}
                        <span className="text-xs text-muted-foreground">
                          · {row.wanted} · od {row.requestedBy} · decyzja: {row.decidedBy ?? '—'},{' '}
                          {row.decidedAt ? formatDateTime(row.decidedAt) : ''}
                        </span>
                      </p>
                      {row.note && (
                        <p className="text-xs text-muted-foreground">Powód: {row.note}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="sm" onClick={() => void openProof(row)}>
                        Zrzut ekranu
                      </Button>
                      <RequestStatusBadge status={row.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Zrzut ekranu: {viewing?.personName}</DialogTitle>
            <DialogDescription>
              Sprawdź, czy ta osoba rzeczywiście prosi o zmianę terminu ważności PWZ.
            </DialogDescription>
          </DialogHeader>
          {proofError ? (
            <p role="alert" className="text-sm text-destructive">
              Nie udało się wczytać zrzutu ekranu.
            </p>
          ) : proof ? (
            <img
              src={proof}
              alt="Zrzut ekranu wiadomości dołączony do wniosku"
              className="max-h-[70vh] w-full rounded border object-contain"
            />
          ) : (
            <p className="text-muted-foreground">Wczytywanie…</p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={rejecting !== null} onOpenChange={(open) => !open && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Odrzuć wniosek: {rejecting?.personName}</DialogTitle>
            <DialogDescription>
              Powód jest opcjonalny, ale kierownictwo zobaczy go przy swoim wniosku.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="expiry-reject-reason">Powód odrzucenia</Label>
            <Input
              id="expiry-reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRejecting(null)}>
              Anuluj
            </Button>
            <Button
              disabled={rejecting === null || busyId === rejecting.id}
              onClick={() => rejecting && void decide(rejecting, 'reject', reason)}
            >
              Odrzuć wniosek
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
