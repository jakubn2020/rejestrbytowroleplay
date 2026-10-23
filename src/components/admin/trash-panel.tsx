import { useCallback, useEffect, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Panel } from '@/components/admin/panel'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TRASH_RETENTION_DAYS, formatDate } from '@/lib/registry'
import {
  listTrash,
  purgePractitioner,
  restorePractitioner,
} from '@/lib/registry.functions'

type TrashRow = Awaited<ReturnType<typeof listTrash>>[number]

/** Admin: entries moved to the trash can be restored for TRASH_RETENTION_DAYS days. */
export function TrashPanel({ onChanged }: { onChanged: () => void }) {
  const [rows, setRows] = useState<TrashRow[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setRows(await listTrash())
    } catch {
      setFailed(true)
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function restore(row: TrashRow) {
    try {
      const result = await restorePractitioner({ data: { id: row.id } })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Wpis przywrócony.')
      onChanged() // refreshes the registry table and remounts this panel
    } catch {
      toast.error('Nie udało się przywrócić wpisu.')
    }
  }

  async function purge(row: TrashRow) {
    if (
      !confirm(
        `Usunąć trwale ${row.firstName} ${row.lastName}? Tej operacji nie można cofnąć.`,
      )
    ) {
      return
    }
    try {
      const result = await purgePractitioner({ data: { id: row.id } })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Wpis usunięty trwale.')
      onChanged()
    } catch {
      toast.error('Nie udało się usunąć wpisu.')
    }
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Trash2 className="size-5" /> Kosz
          {rows && !failed ? ` (${rows.length})` : ''}
        </h2>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Odśwież
        </Button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Usunięte wpisy można przywrócić przez {TRASH_RETENTION_DAYS} dni, potem są
        usuwane na stałe.
      </p>
      {rows === null ? (
        <p className="mt-4 text-muted-foreground">Wczytywanie…</p>
      ) : failed ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          Nie udało się wczytać kosza.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-muted-foreground">Kosz jest pusty.</p>
      ) : (
        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Imię i nazwisko</TableHead>
                <TableHead>PWZ</TableHead>
                <TableHead>Zawód</TableHead>
                <TableHead>Usunięto</TableHead>
                <TableHead>Zostało dni</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.firstName} {row.lastName}
                  </TableCell>
                  <TableCell className="font-mono">{row.pwz}</TableCell>
                  <TableCell>{row.profession}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(row.deletedAt)}
                  </TableCell>
                  <TableCell>{row.daysLeft}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Przywróć ${row.firstName} ${row.lastName}`}
                      onClick={() => void restore(row)}
                    >
                      <RotateCcw className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Usuń trwale ${row.firstName} ${row.lastName}`}
                      onClick={() => void purge(row)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  )
}
