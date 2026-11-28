import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  MAX_TEMPLATES_PER_CATEGORY,
  MAX_TEMPLATE_LENGTH,
  REASON_CATEGORIES,
  normalizeReasonTemplates,
  type ReasonCategory,
  type ReasonTemplates,
} from '@/lib/reason-templates'
import { getReasonTemplates, saveReasonTemplates } from '@/lib/reason-templates.functions'

// One request per page load, shared by every reason field.
let cache: Promise<ReasonTemplates> | null = null
function loadTemplates(force = false): Promise<ReasonTemplates> {
  if (!cache || force) {
    cache = getReasonTemplates().catch(() => {
      cache = null
      return normalizeReasonTemplates({})
    })
  }
  return cache
}

/** Row of ready-made reasons under a reason field: one click puts the text into the field. */
export function ReasonTemplates({
  category,
  onPick,
  maxLength = 300,
}: {
  category: ReasonCategory
  onPick: (text: string) => void
  maxLength?: number
}) {
  const [items, setItems] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    void loadTemplates().then((all) => alive && setItems(all[category]))
    return () => {
      alive = false
    }
  }, [category])

  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Gotowe powody">
      {items.map((text) => (
        <button
          key={text}
          type="button"
          onClick={() => onPick(text.slice(0, maxLength))}
          className="rounded-full border bg-muted/40 px-2.5 py-0.5 text-xs hover:bg-muted"
        >
          {text}
        </button>
      ))}
    </div>
  )
}

/** Owner: edit the ready-made reasons (one reason per line). */
export function ReasonTemplatesEditor() {
  const [text, setText] = useState<Record<ReasonCategory, string> | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void loadTemplates().then((all) =>
      setText(Object.fromEntries(REASON_CATEGORIES.map(({ key }) => [key, all[key].join('\n')])) as Record<ReasonCategory, string>),
    )
  }, [])

  if (!text) return null

  async function save() {
    if (!text) return
    setBusy(true)
    try {
      const lines = Object.fromEntries(REASON_CATEGORIES.map(({ key }) => [key, text[key].split('\n')])) as ReasonTemplates
      const result = await saveReasonTemplates({ data: lines })
      cache = Promise.resolve(result.templates)
      void loadTemplates(false)
      setText(Object.fromEntries(REASON_CATEGORIES.map(({ key }) => [key, result.templates[key].join('\n')])) as Record<ReasonCategory, string>)
      toast.success('Zapisano szablony powodów.')
    } catch {
      toast.error('Nie udało się zapisać szablonów.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-4">
      <h3 className="text-sm font-semibold">Szablony powodów</h3>
      <p className="text-xs text-muted-foreground">
        Gotowe powody pojawiają się jako przyciski pod polami „Powód” (odrzucanie wniosków, zawieszanie kont, blokada IP).
        Jeden powód w linii, do {MAX_TEMPLATES_PER_CATEGORY} na kategorię i {MAX_TEMPLATE_LENGTH} znaków.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        {REASON_CATEGORIES.map(({ key, label, hint }) => (
          <label key={key} className="space-y-1 text-sm">
            <span className="font-medium">{label}</span>
            <span className="block text-xs text-muted-foreground">{hint}</span>
            <textarea
              value={text[key]}
              onChange={(e) => setText({ ...text, [key]: e.target.value })}
              rows={7}
              className="w-full rounded-md border border-input bg-white p-2 text-sm"
            />
          </label>
        ))}
      </div>
      <Button size="sm" disabled={busy} onClick={() => void save()}>
        Zapisz szablony
      </Button>
    </div>
  )
}
