import { useEffect, useState } from 'react'
import { CheckCircle2, ListChecks } from 'lucide-react'

import { Panel } from '@/components/admin/panel'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/registry'
import { getTodo, type TodoInfo } from '@/lib/todo.functions'

type Target = 'requests' | 'reports' | 'alerts' | 'security'

/** Admin: the start dashboard with everything that needs doing now. */
export function TodoPanel({ onOpen, onHide }: { onOpen: (target: Target) => void; onHide: () => void }) {
  const [info, setInfo] = useState<TodoInfo | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    getTodo()
      .then((result) => {
        if (active) setInfo(result)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [])

  if (failed) return null
  if (info === null) return null

  type Item = { key: string; text: string; target?: Target; button?: string; tone: 'red' | 'amber' | 'plain' }
  const items: Item[] = []
  const requestsTotal = info.entryRequests + info.expiryRequests
  if (requestsTotal > 0) {
    const waiting =
      info.oldestRequestHours !== null && info.oldestRequestHours >= 24
        ? ` (najstarszy czeka ${Math.floor(info.oldestRequestHours / 24)} dni)`
        : ''
    items.push({
      key: 'requests',
      text: `Wnioski do rozpatrzenia: ${info.entryRequests} o wpis, ${info.expiryRequests} o zmianę terminu${waiting}`,
      target: 'requests',
      button: 'Otwórz wnioski',
      tone: info.oldestRequestHours !== null && info.oldestRequestHours >= 24 ? 'red' : 'amber',
    })
  }
  if (info.reports > 0) {
    items.push({ key: 'reports', text: `Zgłoszenia błędów do sprawdzenia: ${info.reports}`, target: 'reports', button: 'Otwórz zgłoszenia', tone: 'amber' })
  }
  if (info.alerts > 0) {
    items.push({
      key: 'alerts',
      text: `Nieprzeczytane alerty bezpieczeństwa: ${info.alerts}${info.seriousAlerts ? ` (w tym ${info.seriousAlerts} wysokiej wagi)` : ''}`,
      target: 'alerts',
      button: 'Otwórz alerty',
      tone: info.seriousAlerts ? 'red' : 'amber',
    })
  }
  if (info.expiringSoon.length > 0) {
    items.push({
      key: 'expiring',
      text: `PWZ wygasające w ciągu 7 dni: ${info.expiringSoon.map((p) => `${p.name} (${formatDate(p.expiresAt)})`).join(', ')}`,
      tone: 'amber',
    })
  }
  if (info.expiredRecently > 0) {
    items.push({ key: 'expired', text: `Wpisy, które wygasły w ostatnich 7 dniach: ${info.expiredRecently}`, tone: 'plain' })
  }
  if (info.backupDays !== undefined && (info.backupDays === null || info.backupDays >= 7)) {
    items.push({
      key: 'backup',
      text: info.backupDays === null ? 'Nie zrobiono jeszcze żadnej kopii zapasowej rejestru' : `Ostatnia kopia zapasowa ma ${info.backupDays} dni`,
      target: 'security',
      button: 'Centrum bezpieczeństwa',
      tone: 'amber',
    })
  }

  const toneClass = { red: 'border-red-300 bg-red-50 dark:bg-red-950/30', amber: 'border-amber-300 bg-amber-50 dark:bg-amber-950/30', plain: 'border-border bg-muted/30' }

  return (
    <Panel>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <ListChecks className="size-5" /> Do zrobienia teraz
        </h2>
        <Button type="button" variant="ghost" size="sm" onClick={onHide}>
          Ukryj
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-emerald-600" /> Wszystko załatwione. Nic nie czeka na Twoją decyzję.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {items.map((item) => (
            <li key={item.key} className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${toneClass[item.tone]}`}>
              <span>{item.text}</span>
              {item.target && item.button && (
                <Button size="sm" variant="outline" onClick={() => onOpen(item.target as Target)}>
                  {item.button}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
