import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { EXAMINER_LIMIT_FIELDS, type ExaminerLimits } from '@/lib/examiners'
import { getExaminerLimits, saveExaminerLimits } from '@/lib/examiners.functions'

/** Owner only: every limit of the examiner and moderator roles. */
export function ExaminerLimitsSection() {
  const [limits, setLimits] = useState<ExaminerLimits | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getExaminerLimits()
      .then(setLimits)
      .catch(() => toast.error('Nie udało się wczytać limitów egzaminatorów.'))
  }, [])
  if (!limits) return null

  async function save() {
    if (!limits) return
    setBusy(true)
    try {
      await saveExaminerLimits({ data: limits })
      toast.success('Limity zapisane. Obowiązują od razu.')
      setLimits(await getExaminerLimits())
    } catch {
      toast.error('Nie udało się zapisać limitów.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 rounded-md border p-4">
      <h3 className="text-sm font-semibold">Limity egzaminatorów i moderatorów</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {EXAMINER_LIMIT_FIELDS.map((field) => (
          <div key={field.key} className="space-y-1">
            <label htmlFor={`exlim-${field.key}`} className="text-sm font-medium">{field.label}</label>
            <input
              id={`exlim-${field.key}`}
              type="number"
              min={field.min}
              max={field.max}
              value={limits[field.key]}
              onChange={(e) => setLimits({ ...limits, [field.key]: Number(e.target.value) })}
              className="h-9 w-full rounded-md border border-input bg-white px-3 text-sm"
            />
            <p className="text-xs text-muted-foreground">{field.hint} (od {field.min} do {field.max})</p>
          </div>
        ))}
      </div>
      <Button type="button" onClick={() => void save()} disabled={busy}>{busy ? 'Zapisywanie…' : 'Zapisz limity'}</Button>
    </div>
  )
}
