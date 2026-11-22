import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Sparkles, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { ChangelogEntry } from '@/lib/changelog'
import { getChangelog } from '@/lib/changelog.functions'

const KEY = 'seen-version'

/** After signing in: shows what changed in the newest version, until it is dismissed. */
export function WhatsNewBar() {
  const [latest, setLatest] = useState<ChangelogEntry | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    getChangelog()
      .then((entries) => {
        const first = entries[0]
        if (!first) return
        setLatest(first)
        try {
          if (localStorage.getItem(KEY) !== first.version) setOpen(true)
        } catch {
          setOpen(true)
        }
      })
      .catch(() => undefined)
  }, [])

  function dismiss() {
    setOpen(false)
    try {
      if (latest) localStorage.setItem(KEY, latest.version)
    } catch {
      // it will show again next time
    }
  }

  if (!open || !latest) return null
  return (
    <div role="status" className="rounded-lg border border-[var(--registry-navy)]/30 bg-white px-4 py-3 text-sm shadow-sm dark:bg-card">
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-4" /> Co nowego w wersji {latest.version}: {latest.title}
        </p>
        <Button type="button" variant="ghost" size="icon" onClick={dismiss} aria-label="Zamknij">
          <X className="size-4" />
        </Button>
      </div>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-muted-foreground">
        {latest.changes.map((change) => (<li key={change}>{change}</li>))}
      </ul>
      <p className="mt-2">
        <Link to="/zmiany" className="underline">Cały dziennik zmian</Link>
      </p>
    </div>
  )
}
