import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Sparkles, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CHANGELOG, SITE_VERSION } from '@/lib/changelog'

const KEY = 'seen-version'

/** After signing in: shows what changed in the newest version, until it is dismissed. */
export function WhatsNewBar() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) !== SITE_VERSION) setOpen(true)
    } catch {
      setOpen(true)
    }
  }, [])

  function dismiss() {
    setOpen(false)
    try {
      localStorage.setItem(KEY, SITE_VERSION)
    } catch {
      // it will show again next time
    }
  }

  if (!open) return null
  const latest = CHANGELOG[0]
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
