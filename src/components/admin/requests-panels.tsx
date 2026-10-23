import { useCallback, useEffect, useState } from 'react'
import { Check, Inbox, X } from 'lucide-react'
import { toast } from 'sonner'

import { Panel } from '@/components/admin/panel'
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
  REQUEST_STATUSES,
  formatDateTime,
  type RequestStatus,
} from '@/lib/registry'
import {
  decideRequest,
  getRequestProof,
  listMyRequests,
  listRequests,
  type RequestRow,
} from '@/lib/requests.functions'

const STATUS_STYLES: Record<RequestStatus, string> = {
  pending: 'bg-amber-50 text-amber-800 ring-amber-200',
  approved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  rejected: 'bg-red-50 text-red-700 ring-red-200',
}

function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ring-1 ${STATUS_STYLES[status]}`}
    >
      {REQUEST_STATUSES[status]}
    </span>
  )
}

/** kierownictwo: their own requests and what the admins decided. */
export function MyRequestsPanel() {
  const [rows, setRows] = useState<RequestRow[] | null>(null)

  useEffect(() => {
    let active = true
    listMyRequests()
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

  return (
    <Panel>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Inbox className="size-5" /> Moje wnioski{rows ? ` (${rows.length})` : ''}
      </h2>
      {rows === null ? (
        <p className="mt-4 text-muted-foreground">Wczytywanie…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-muted-foreground">Nie złożono jeszcze żadnego wniosku.</p>
      ) : (
        <ul className="mt-4 divide-y">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 py-3">
              <div>
                <p className="font-medium">
                  {row.firstName} {row.lastName}{' '}
                  <span className="font-mono text-xs font-normal text-muted-foreground">
                    PESEL {row.pesel}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {row.profession} · złożono {formatDateTime(row.createdAt)}
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

/** Admin: pending requests with the screenshot, plus the history of decisions. */
export function RequestsPanel({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<RequestRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [viewing, setViewing] = useState<RequestRow | null>(null)
  const [proof, setProof] = useState<string | null>(null)
  const [proofError, setProofError] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [rejecting, setRejecting] = useState<RequestRow | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setRows(await listRequests())
    } catch {
      setFailed(true)
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function openProof(row: RequestRow) {
    setViewing(row)
    setProof(null)
    setProofError(false)
    try {
      const result = await getRequestProof({ data: { id: row.id } })
      if (result.proof) setProof(result.proof)
      else setProofError(true)
    } catch {
      setProofError(true)
    }
  }

  async function decide(row: RequestRow, decision: 'approve' | 'reject', note?: string) {
    setBusyId(row.id)
    try {
      const result = await decideRequest({ data: { id: row.id, decision, note } })
      if (!result.ok) {
        toast.error(result.error)
        await load()
        return
      }
      toast.success(
        decision === 'approve'
          ? `Zaakceptowano. ${row.firstName} ${row.lastName} jest w rejestrze.`
          : 'Wniosek odrzucony.',
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Inbox className="size-5" /> Wnioski kierownictwa
          {rows && !failed ? ` (oczekujące: ${pending.length})` : ''}
        </h2>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Odśwież
        </Button>
      </div>

      {rows === null ? (
        <p className="mt-4 text-muted-foreground">Wczytywanie…</p>
      ) : failed ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          Nie udało się wczytać wniosków.
        </p>
      ) : (
        <>
          {pending.length === 0 ? (
            <p className="mt-4 text-muted-foreground">Brak wniosków oczekujących na decyzję.</p>
          ) : (
            <ul className="mt-4 divide-y rounded-md border">
              {pending.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {row.firstName} {row.lastName}{' '}
                      <span className="font-mono text-xs font-normal text-muted-foreground">
                        PESEL {row.pesel}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.profession}
                      {row.specialization ? ` · ${row.specialization}` : ''} · od{' '}
                      {row.requestedBy} · {formatDateTime(row.createdAt)}
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
                        {row.firstName} {row.lastName}{' '}
                        <span className="text-xs text-muted-foreground">
                          · od {row.requestedBy} · decyzja: {row.decidedBy ?? '—'},{' '}
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
            <DialogTitle>
              Zrzut ekranu: {viewing?.firstName} {viewing?.lastName}
            </DialogTitle>
            <DialogDescription>
              Sprawdź, czy ta osoba rzeczywiście prosi o wpis do rejestru.
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
            <DialogTitle>
              Odrzuć wniosek: {rejecting?.firstName} {rejecting?.lastName}
            </DialogTitle>
            <DialogDescription>
              Powód jest opcjonalny, ale kierownictwo zobaczy go przy swoim wniosku.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">Powód odrzucenia</Label>
            <Input
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              placeholder="np. zrzut ekranu jest nieczytelny"
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
