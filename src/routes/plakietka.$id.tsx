import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Printer } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { BADGE_LAYOUTS, BadgeCard, type BadgeLayout } from '@/components/badge-card'
import { ENTRY_STATUSES, verificationPath } from '@/lib/registry'
import { getBadge } from '@/lib/registry.functions'

export const Route = createFileRoute('/plakietka/$id')({
  head: () => ({
    meta: [
      { title: 'Plakietka – Centralny Rejestr' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
  component: BadgePage,
})

type Badge = NonNullable<Awaited<ReturnType<typeof getBadge>>>

type State =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'error' }
  | { phase: 'ready'; badge: Badge }

function BadgePage() {
  const { id } = Route.useParams()
  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    let active = true
    const numeric = Number(id)
    if (!Number.isInteger(numeric) || numeric <= 0) {
      setState({ phase: 'missing' })
      return
    }
    getBadge({ data: { id: numeric } })
      .then((badge) => {
        if (active) setState(badge ? { phase: 'ready', badge } : { phase: 'missing' })
      })
      .catch(() => {
        if (active) setState({ phase: 'error' })
      })
    return () => {
      active = false
    }
  }, [id])

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 print:max-w-none print:p-0">
      <div className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
        {state.phase === 'ready' && (
          <Button onClick={() => window.print()}>
            <Printer className="size-4" /> Drukuj plakietkę
          </Button>
        )}
        <Button asChild variant="outline">
          <a href="/admin">Wróć do panelu</a>
        </Button>
      </div>

      {state.phase === 'loading' && (
        <p className="text-muted-foreground print:hidden">Wczytywanie…</p>
      )}
      {state.phase === 'missing' && (
        <p className="rounded-lg border border-dashed bg-white px-5 py-8 text-center text-muted-foreground print:hidden">
          Nie znaleziono wpisu. Plakietki są dostępne tylko po zalogowaniu jako
          kierownictwo lub administrator.
        </p>
      )}
      {state.phase === 'error' && (
        <p
          role="alert"
          className="rounded-lg border border-dashed bg-white px-5 py-8 text-center text-destructive print:hidden"
        >
          Nie udało się wczytać plakietki. Zaloguj się w panelu i spróbuj ponownie.
        </p>
      )}
      {state.phase === 'ready' && <BadgeView badge={state.badge} />}
    </div>
  )
}

function BadgeView({ badge }: { badge: Badge }) {
  const [layout, setLayout] = useState<BadgeLayout>('horizontal')
  const url = `${window.location.origin}${verificationPath(badge.pwz)}`

  return (
    <div>
      {badge.status !== 'active' && (
        <p
          role="status"
          className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden"
        >
          Wpis ma status „{ENTRY_STATUSES[badge.status]}”. Po zeskanowaniu kodu QR
          ta plakietka pokaże, że wpis jest nieaktualny.
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden" role="group" aria-label="Układ plakietki">
        <span className="text-sm text-muted-foreground">Układ:</span>
        {BADGE_LAYOUTS.map((option) => (
          <Button
            key={option.key}
            type="button"
            size="sm"
            variant={layout === option.key ? 'default' : 'outline'}
            onClick={() => setLayout(option.key)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {/* The card is a real ID-1 size; on screen it is enlarged, when printing it is real size. */}
      <BadgeCard badge={badge} url={url} layout={layout} />

      <p className="mt-4 text-xs text-muted-foreground print:hidden">
        Plakietka zawiera PESEL (poza układem „Mini”), dlatego jest widoczna tylko dla kierownictwa i
        administratorów. Kod QR prowadzi do publicznej strony, która pokazuje
        wyłącznie, czy wpis jest prawdziwy i aktualny: {url}
      </p>
    </div>
  )
}
