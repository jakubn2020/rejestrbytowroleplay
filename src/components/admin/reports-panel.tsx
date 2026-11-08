import { useCallback, useEffect, useState } from 'react'
import { Flag } from 'lucide-react'
import { toast } from 'sonner'

import { Panel } from '@/components/admin/panel'
import { Button } from '@/components/ui/button'
import { formatDateTime } from '@/lib/registry'
import {
  deleteReport,
  listReports,
  setReportStatus,
  type ReportRow,
} from '@/lib/reports.functions'

/** Admin: mistakes in the registry reported by visitors. */
export function ReportsPanel({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<ReportRow[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setRows(await listReports())
    } catch {
      setFailed(true)
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function toggle(row: ReportRow) {
    try {
      await setReportStatus({
        data: { id: row.id, status: row.status === 'open' ? 'done' : 'open' },
      })
      await load()
      onChanged()
    } catch {
      toast.error('Nie udało się zmienić statusu zgłoszenia.')
    }
  }

  async function remove(row: ReportRow) {
    if (!confirm('Usunąć to zgłoszenie?')) return
    try {
      await deleteReport({ data: { id: row.id } })
      await load()
      onChanged()
    } catch {
      toast.error('Nie udało się usunąć zgłoszenia.')
    }
  }

  const open = rows?.filter((r) => r.status === 'open').length ?? 0

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Flag className="size-5" /> Zgłoszenia błędów
          {rows && !failed ? ` (otwarte: ${open})` : ''}
        </h2>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Odśwież
        </Button>
      </div>
      {rows === null ? (
        <p className="mt-4 text-muted-foreground">Wczytywanie…</p>
      ) : failed ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          Nie udało się wczytać zgłoszeń.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-muted-foreground">Nikt jeszcze nie zgłosił błędu.</p>
      ) : (
        <ul className="mt-4 divide-y rounded-md border">
          {rows.map((row) => (
            <li
              key={row.id}
              className={`flex flex-wrap items-start justify-between gap-3 p-3 text-sm ${row.status === 'done' ? 'opacity-60' : ''}`}
            >
              <div className="min-w-0 max-w-prose">
                <p className="font-semibold">{row.subject}</p>
                <p className="whitespace-pre-wrap break-words">{row.message}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(row.createdAt)}
                  {row.contact ? ` · kontakt: ${row.contact}` : ''}
                  {row.status === 'done' && row.handledBy ? ` · załatwił(a): ${row.handledBy}` : ''}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => void toggle(row)}>
                  {row.status === 'open' ? 'Oznacz jako załatwione' : 'Otwórz ponownie'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void remove(row)}>
                  Usuń
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
