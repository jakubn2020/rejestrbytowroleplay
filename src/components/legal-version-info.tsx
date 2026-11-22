import { formatDate } from '@/lib/registry'
import type { LegalVersion } from '@/lib/legal'

/** Current version of a legal text with its change history. */
export function LegalVersionInfo({ versions }: { versions: LegalVersion[] }) {
  const [current] = versions
  return (
    <section className="mt-6 rounded-lg border bg-white p-5 shadow-sm">
      <h2 className="font-semibold">Wersja i historia zmian</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Obowiązuje wersja {current.version} z dnia {formatDate(`${current.date}T12:00:00Z`)}.
      </p>
      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
        {versions.map((entry) => (
          <li key={entry.version}>
            <span className="font-medium text-foreground">
              Wersja {entry.version} ({formatDate(`${entry.date}T12:00:00Z`)}):
            </span>{' '}
            {entry.summary}
          </li>
        ))}
      </ul>
    </section>
  )
}
