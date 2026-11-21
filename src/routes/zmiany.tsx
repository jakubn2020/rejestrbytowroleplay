import { createFileRoute } from '@tanstack/react-router'

import { CHANGELOG } from '@/lib/changelog'
import { formatDate } from '@/lib/registry'

export const Route = createFileRoute('/zmiany')({
  head: () => ({
    meta: [{ title: 'Dziennik zmian – Centralny Rejestr' }],
  }),
  component: Changelog,
})

function Changelog() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-[var(--registry-navy)] sm:text-4xl">
        Dziennik zmian
      </h1>
      <p className="mt-3 text-muted-foreground">Co zmieniło się w kolejnych aktualizacjach strony.</p>
      <div className="mt-8 space-y-4">
        {CHANGELOG.map((entry) => (
          <article key={entry.version} className="rounded-lg border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">
                Aktualizacja {entry.version}: {entry.title}
              </h2>
              <time className="text-sm text-muted-foreground" dateTime={entry.date}>
                {formatDate(`${entry.date}T12:00:00Z`)}
              </time>
            </div>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {entry.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  )
}
