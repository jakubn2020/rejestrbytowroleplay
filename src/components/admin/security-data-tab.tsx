import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { BrandingSection } from '@/components/admin/branding-section'
import { OwnerControlsSection } from '@/components/admin/owner-controls-section'
import { Button } from '@/components/ui/button'
import { downloadText } from '@/lib/download'
import { formatDateTime } from '@/lib/registry'
import {
  createBackup,
  downloadBackup,
  getSecuritySettings,
  listBackups,
  listPeselViews,
  restoreBackup,
  saveSecuritySettings,
  type BackupRow,
  type PeselViewRow,
} from '@/lib/security-ops.functions'
import type { SecuritySettings } from '@/lib/site-settings-server'

function Slider({
  id,
  label,
  hint,
  value,
  min,
  max,
  format,
  onChange,
}: {
  id: string
  label: string
  hint: string
  value: number
  min: number
  max: number
  format: (value: number) => string
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-sm">
        <label htmlFor={id} className="font-medium">{label}</label>
        <span className="font-mono">{format(value)}</span>
      </div>
      <input id={id} type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

/** Owner only: policy sliders, PESEL reveal log and backups. */
export function SecurityDataTab() {
  const [settings, setSettings] = useState<SecuritySettings | null>(null)
  const [views, setViews] = useState<PeselViewRow[]>([])
  const [backups, setBackups] = useState<BackupRow[]>([])
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const [s, v, b] = await Promise.all([getSecuritySettings(), listPeselViews(), listBackups()])
      setSettings(s)
      setViews(v)
      setBackups(b)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    if (!settings) return
    setBusy(true)
    try {
      await saveSecuritySettings({
        data: {
          peselThreshold: settings.peselThreshold,
          peselDailyLimit: settings.peselDailyLimit,
          maxSessions: settings.maxSessions,
          unusedDays: settings.unusedDays,
        },
      })
      toast.success('Ustawienia zapisane.')
    } catch {
      toast.error('Nie udało się zapisać ustawień.')
    } finally {
      setBusy(false)
    }
  }

  async function backup() {
    setBusy(true)
    try {
      await createBackup()
      toast.success('Kopia zapasowa utworzona.')
      await load()
    } catch {
      toast.error('Nie udało się utworzyć kopii.')
    } finally {
      setBusy(false)
    }
  }

  async function download(row: BackupRow) {
    try {
      const result = await downloadBackup({ data: { id: row.id } })
      downloadText(`kopia-rejestru-${row.id}.json`, result.data, 'application/json;charset=utf-8')
    } catch {
      toast.error('Nie udało się pobrać kopii.')
    }
  }

  async function restore(row: BackupRow) {
    if (!window.confirm(`Przywrócić kopię nr ${row.id} (${row.entries} wpisów)? Brakujące wpisy zostaną dodane, a istniejące (po numerze PESEL) zaktualizowane danymi z kopii. Nic nie zostanie usunięte. Najpierw powstanie kopia obecnego stanu.`)) return
    setBusy(true)
    try {
      const result = await restoreBackup({ data: { id: row.id } })
      if (!result.ok) toast.error(result.error)
      else toast.success(`Przywrócono ${result.restored} wpisów (błędy: ${result.failed}).`)
      await load()
    } catch {
      toast.error('Nie udało się przywrócić kopii.')
    } finally {
      setBusy(false)
    }
  }

  if (failed) return <p role="alert" className="text-sm text-destructive">Nie udało się wczytać danych.</p>
  if (settings === null) return <p className="text-muted-foreground">Wczytywanie…</p>
  const set = (patch: Partial<SecuritySettings>) => setSettings({ ...settings, ...patch })

  return (
    <div className="space-y-6">
      <OwnerControlsSection />
      <BrandingSection />
      <div className="space-y-4 rounded-md border p-4">
        <h3 className="text-sm font-semibold">Ustawienia (suwaki)</h3>
        <Slider id="s-threshold" label="Alert masowego odsłaniania PESEL" hint="Ile odsłonięć PESEL przez jedno konto w 10 minut wywołuje alert." value={settings.peselThreshold} min={3} max={100} format={(v) => `${v} / 10 min`} onChange={(v) => set({ peselThreshold: v })} />
        <Slider id="s-daily" label="Dzienny limit odsłonięć PESEL na konto" hint="Po przekroczeniu konto nie odsłoni więcej numerów do następnego dnia. 0 = bez limitu." value={settings.peselDailyLimit} min={0} max={300} format={(v) => (v === 0 ? 'bez limitu' : `${v} / dobę`)} onChange={(v) => set({ peselDailyLimit: v })} />
        <Slider id="s-sessions" label="Jednoczesne sesje na konto" hint="Starsze sesje są kończone, gdy konto przekroczy limit. 0 = bez limitu." value={settings.maxSessions} min={0} max={10} format={(v) => (v === 0 ? 'bez limitu' : String(v))} onChange={(v) => set({ maxSessions: v })} />
        <Slider id="s-unused" label="Blokada nieużywanych kont" hint="Po ilu dniach bez logowania konto jest blokowane automatycznie. 0 = wyłączone." value={settings.unusedDays} min={0} max={180} format={(v) => (v === 0 ? 'wyłączone' : `${v} dni`)} onChange={(v) => set({ unusedDays: v })} />
        <Button size="sm" disabled={busy} onClick={() => void save()}>Zapisz ustawienia</Button>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Kopie zapasowe rejestru ({backups.length})</h3>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void backup()}>Utwórz kopię teraz</Button>
        </div>
        {backups.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Brak kopii. Przechowywanych jest 10 najnowszych.</p>
        ) : (
          <ul className="mt-2 divide-y rounded-md border text-sm">
            {backups.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>#{row.id} · {formatDateTime(row.createdAt)} · wpisów: {row.entries} · {row.createdBy}</span>
                <span className="flex gap-1.5">
                  <Button variant="outline" size="sm" onClick={() => void download(row)}>Pobierz</Button>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void restore(row)}>Przywróć</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">Kopia zawiera wpisy z rejestru (bez kosza). Kopie robi się ręcznie: wejdź tu i kliknij raz na jakiś czas.</p>
      </div>

      <div>
        <h3 className="text-sm font-semibold">Kto oglądał czyj PESEL (ostatnie {views.length})</h3>
        {views.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Brak odsłonięć.</p>
        ) : (
          <ul className="mt-2 max-h-96 divide-y overflow-y-auto rounded-md border text-sm">
            {views.map((v) => (
              <li key={v.id} className="px-3 py-2">
                <p><span className="font-medium">{v.actor}</span> <span className="text-xs text-muted-foreground">({v.actorRole})</span> → {v.target}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(v.createdAt)} · {v.purpose ?? ''}{v.ip ? ` · IP ${v.ip}` : ''}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
