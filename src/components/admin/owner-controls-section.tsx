import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  getOwnerControls,
  saveOwnerControls,
  type OwnerControls,
} from '@/lib/owner-controls.functions'

/** Owner only: notices for visitors and staff, and switches for public reports and staff requests. */
export function OwnerControlsSection() {
  const [controls, setControls] = useState<OwnerControls | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getOwnerControls()
      .then(setControls)
      .catch(() => toast.error('Nie udało się wczytać sterowania stroną.'))
  }, [])

  if (!controls) return null
  const set = (patch: Partial<OwnerControls>) => setControls({ ...controls, ...patch })

  async function save() {
    if (!controls) return
    setBusy(true)
    try {
      await saveOwnerControls({ data: controls })
      toast.success('Zapisano. Ogłoszenia są widoczne po odświeżeniu stron.')
    } catch {
      toast.error('Nie udało się zapisać.')
    } finally {
      setBusy(false)
    }
  }

  const area = 'w-full rounded-md border border-input bg-white px-3 py-2 text-sm'
  return (
    <div className="space-y-4 rounded-md border p-4">
      <h3 className="text-sm font-semibold">Sterowanie stroną</h3>

      <div className="space-y-1">
        <label htmlFor="oc-public" className="text-sm font-medium">Ogłoszenie dla odwiedzających (pasek pod nagłówkiem)</label>
        <textarea id="oc-public" rows={2} maxLength={300} className={area} value={controls.noticePublic} onChange={(e) => set({ noticePublic: e.target.value })} placeholder="Puste = brak ogłoszenia" />
        <div className="flex items-center gap-2 text-xs">
          <label htmlFor="oc-level">Rodzaj:</label>
          <select id="oc-level" className="h-8 rounded-md border border-input bg-white px-2" value={controls.noticePublicLevel} onChange={(e) => set({ noticePublicLevel: e.target.value as 'info' | 'warning' })}>
            <option value="info">Informacja</option>
            <option value="warning">Ostrzeżenie</option>
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="oc-staff" className="text-sm font-medium">Ogłoszenie dla obsługi (widoczne po zalogowaniu do panelu)</label>
        <textarea id="oc-staff" rows={2} maxLength={500} className={area} value={controls.noticeStaff} onChange={(e) => set({ noticeStaff: e.target.value })} placeholder="Puste = brak ogłoszenia" />
      </div>

      <div className="space-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={controls.reportsOpen} onChange={(e) => set({ reportsOpen: e.target.checked })} />
          Przyjmuj zgłoszenia od odwiedzających (strona „Kontakt i zgłoszenia”)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={controls.requestsOpen} onChange={(e) => set({ requestsOpen: e.target.checked })} />
          Pozwól kierownictwu składać wnioski (o wpis i o zmianę terminu)
        </label>
      </div>
      <Button size="sm" disabled={busy} onClick={() => void save()}>Zapisz sterowanie</Button>
    </div>
  )
}
