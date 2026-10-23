import { useCallback, useEffect, useState } from 'react'
import { Download, ScrollText } from 'lucide-react'

import { Panel } from '@/components/admin/panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AUDIT_ACTION_LABELS, formatDateTime } from '@/lib/registry'
import { listAuditLog } from '@/lib/registry.functions'

type AuditRow = Awaited<ReturnType<typeof listAuditLog>>[number]

const selectClass =
  'h-9 rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

function actionLabel(action: string) {
  return AUDIT_ACTION_LABELS[action as keyof typeof AUDIT_ACTION_LABELS] ?? action
}

/** Semicolon-separated (Polish Excel), with a BOM so diacritics survive, and formula-safe cells. */
function toCsv(rows: AuditRow[]) {
  const cell = (value: string | null) => {
    const text = value ?? ''
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
    return `"${safe.replace(/"/g, '""')}"`
  }
  const header = ['Kiedy', 'Kto', 'Rola', 'Akcja', 'Dotyczy', 'Szczegóły']
  const lines = rows.map((row) =>
    [
      formatDateTime(row.createdAt),
      row.actor,
      row.actorRole,
      actionLabel(row.action),
      row.target,
      row.details,
    ]
      .map(cell)
      .join(';'),
  )
  return '﻿' + [header.map(cell).join(';'), ...lines].join('\r\n')
}

function download(rows: AuditRow[]) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `dziennik-zdarzen-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function AuditLogPanel() {
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [actor, setActor] = useState('')
  const [action, setAction] = useState('')
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    setFailed(false)
    try {
      setRows(await listAuditLog())
    } catch {
      setFailed(true)
      setRows([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const actors = rows ? [...new Set(rows.map((r) => r.actor))].sort() : []
  const actions = rows ? [...new Set(rows.map((r) => r.action))].sort() : []
  const needle = query.trim().toLowerCase()
  const visible = (rows ?? []).filter(
    (row) =>
      (!actor || row.actor === actor) &&
      (!action || row.action === action) &&
      (!needle ||
        [row.actor, row.target, row.details, actionLabel(row.action)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle)),
  )
  const filtering = Boolean(actor || action || needle)

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ScrollText className="size-5" /> Dziennik zdarzeń
          {rows && !failed
            ? filtering
              ? ` (${visible.length} z ${rows.length})`
              : ` (${rows.length})`
            : ''}
        </h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={visible.length === 0}
            onClick={() => download(visible)}
          >
            <Download className="size-4" /> Eksportuj CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Odśwież
          </Button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Kto, co i kiedy zrobił (ostatnie 300 zdarzeń, najnowsze na górze).
        Eksport obejmuje aktualnie widoczne wiersze.
      </p>
      {rows && rows.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          <select
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            className={selectClass}
            aria-label="Filtruj po osobie"
          >
            <option value="">Wszyscy użytkownicy</option>
            {actors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className={selectClass}
            aria-label="Filtruj po akcji"
          >
            <option value="">Wszystkie akcje</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </select>
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj w dzienniku…"
            aria-label="Szukaj w dzienniku"
            className="h-9 w-56"
          />
          {filtering && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setActor('')
                setAction('')
                setQuery('')
              }}
            >
              Wyczyść filtry
            </Button>
          )}
        </div>
      )}
      {rows === null ? (
        <p className="mt-4 text-muted-foreground">Wczytywanie…</p>
      ) : failed ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          Nie udało się wczytać dziennika zdarzeń.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-muted-foreground">Brak zapisanych zdarzeń.</p>
      ) : visible.length === 0 ? (
        <p className="mt-4 text-muted-foreground">
          Brak zdarzeń pasujących do filtrów.
        </p>
      ) : (
        <div className="mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kiedy</TableHead>
                <TableHead>Kto</TableHead>
                <TableHead>Akcja</TableHead>
                <TableHead>Dotyczy</TableHead>
                <TableHead>Szczegóły</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    {row.actor}
                    <span className="block text-xs text-muted-foreground">
                      {row.actorRole}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {actionLabel(row.action)}
                  </TableCell>
                  <TableCell>{row.target}</TableCell>
                  <TableCell className="whitespace-normal">{row.details}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  )
}
