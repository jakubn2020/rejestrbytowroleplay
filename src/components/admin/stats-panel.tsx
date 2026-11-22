import { useEffect, useState } from 'react'
import { BarChart3 } from 'lucide-react'

import { Panel } from '@/components/admin/panel'
import { getManagementActivity, type ManagementActivityRow } from '@/lib/activity.functions'
import { getVisitStats, type VisitStats } from '@/lib/visits.functions'

const PAGE_NAMES: Record<string, string> = {
  '/': 'Wyszukiwarka (strona główna)',
  '/jak-to-dziala': 'Jak to działa / FAQ',
  '/zglos-blad': 'Kontakt i zgłoszenia',
  '/weryfikacja/*': 'Weryfikacja z kodu QR',
  inne: 'Inne strony',
}

const selectClass =
  'h-9 rounded-md border border-input bg-white px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

function shortDay(day: string) {
  const [, month, date] = day.split('-')
  return `${date}.${month}`
}

/** Admin: how many people visit the site (all visitors, anonymous counters). */
export function StatsPanel() {
  const [days, setDays] = useState<7 | 30 | 90>(30)
  const [stats, setStats] = useState<VisitStats | null>(null)
  const [failed, setFailed] = useState(false)
  const [activity, setActivity] = useState<ManagementActivityRow[] | null>(null)

  useEffect(() => {
    let active = true
    setStats(null)
    setFailed(false)
    setActivity(null)
    getManagementActivity({ data: { days } })
      .then((result) => {
        if (active) setActivity(result)
      })
      .catch(() => {
        if (active) setActivity([])
      })
    getVisitStats({ data: { days } })
      .then((result) => {
        if (active) setStats(result)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [days])

  const peak = stats ? Math.max(1, ...stats.days.map((d) => d.views)) : 1
  const today = stats?.days[stats.days.length - 1]

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <BarChart3 className="size-5" /> Statystyki odwiedzin
        </h2>
        <select
          aria-label="Zakres"
          value={days}
          onChange={(e) => setDays(Number(e.target.value) as 7 | 30 | 90)}
          className={selectClass}
        >
          <option value={7}>Ostatnie 7 dni</option>
          <option value={30}>Ostatnie 30 dni</option>
          <option value={90}>Ostatnie 90 dni</option>
        </select>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Liczone dla całej strony (każdy odwiedzający), anonimowo: bez zapisywania adresów IP.
        Nie liczą się panel administratora, plakietki i boty.
      </p>

      {failed ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          Nie udało się wczytać statystyk.
        </p>
      ) : stats === null ? (
        <p className="mt-4 text-muted-foreground">Wczytywanie…</p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Odsłony (okres)" value={stats.totalViews} />
            <Tile label="Odwiedzający (suma dzienna)" value={stats.totalVisitors} />
            <Tile label="Odsłony dziś" value={today?.views ?? 0} />
            <Tile label="Odwiedzający dziś" value={today?.visitors ?? 0} />
          </dl>

          <h3 className="mt-6 text-sm font-semibold">Odsłony dzień po dniu</h3>
          <div
            className="mt-2 flex h-32 items-end gap-px"
            role="img"
            aria-label="Wykres odsłon na dzień"
          >
            {stats.days.map((d) => (
              <div
                key={d.day}
                title={`${shortDay(d.day)}: ${d.views} odsłon, ${d.visitors} odwiedzających`}
                className="flex-1 rounded-t bg-[var(--registry-navy)]/70 dark:bg-primary/70"
                style={{ height: `${Math.max(2, (d.views / peak) * 100)}%` }}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs text-muted-foreground">
            <span>{shortDay(stats.days[0].day)}</span>
            <span>{shortDay(stats.days[stats.days.length - 1].day)}</span>
          </div>

          <h3 className="mt-6 text-sm font-semibold">Najczęściej odwiedzane strony</h3>
          {stats.pages.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Brak danych z tego okresu.</p>
          ) : (
            <ul className="mt-2 divide-y rounded-md border text-sm">
              {stats.pages.map((page) => (
                <li key={page.path} className="flex justify-between gap-3 px-3 py-2">
                  <span>{PAGE_NAMES[page.path] ?? page.path}</span>
                  <span className="font-mono">{page.views}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <h3 className="mt-6 text-sm font-semibold">Najaktywniejsze kierownictwo</h3>
      {activity === null ? (
        <p className="mt-2 text-sm text-muted-foreground">Wczytywanie…</p>
      ) : activity.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Brak aktywności w tym okresie.</p>
      ) : (
        <div className="mt-2 overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Konto</th>
                <th className="px-3 py-2">Odznaka</th>
                <th className="px-3 py-2">Wnioski</th>
                <th className="px-3 py-2">Przyjęte</th>
                <th className="px-3 py-2">Odrzucone</th>
                <th className="px-3 py-2">Logowania</th>
                <th className="px-3 py-2">Odsłonięte PESEL</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {activity.map((row, index) => (
                <tr key={row.identity}>
                  <td className="px-3 py-2 font-mono">{index + 1}</td>
                  <td className="px-3 py-2">{row.identity}</td>
                  <td className="px-3 py-2">{row.badge ?? '—'}</td>
                  <td className="px-3 py-2 font-mono">{row.requests}</td>
                  <td className="px-3 py-2 font-mono">{row.approved}</td>
                  <td className="px-3 py-2 font-mono">{row.rejected}</td>
                  <td className="px-3 py-2 font-mono">{row.logins}</td>
                  <td className="px-3 py-2 font-mono">{row.peselViews}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border px-3 py-3 text-center">
      <dd className="font-[family-name:var(--font-heading)] text-2xl font-bold">{value}</dd>
      <dt className="mt-1 text-xs text-muted-foreground">{label}</dt>
    </div>
  )
}
