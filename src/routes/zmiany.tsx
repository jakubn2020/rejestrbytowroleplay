import { useEffect, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { currentUser } from '@/lib/auth.functions'
import type { ChangelogEntry } from '@/lib/changelog'
import { getChangelog, resetChangelog, saveChangelog } from '@/lib/changelog.functions'
import { formatDate } from '@/lib/registry'

export const Route = createFileRoute('/zmiany')({
  head: () => ({
    meta: [{ title: 'Dziennik zmian – Centralny Rejestr' }],
  }),
  loader: () => getChangelog(),
  component: Changelog,
})

function Changelog() {
  const entries = Route.useLoaderData()
  const router = useRouter()
  const [owner, setOwner] = useState(false)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    currentUser()
      .then((user) => setOwner(Boolean(user?.isSuperAdmin)))
      .catch(() => undefined)
  }, [])

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-[var(--registry-navy)] sm:text-4xl">
          Dziennik zmian
        </h1>
        {owner && !editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edytuj dziennik
          </Button>
        )}
      </div>
      <p className="mt-3 text-muted-foreground">Co zmieniło się w kolejnych aktualizacjach strony.</p>

      {editing ? (
        <Editor
          initial={entries}
          onDone={async () => {
            setEditing(false)
            await router.invalidate()
          }}
        />
      ) : (
        <div className="mt-8 space-y-4">
          {entries.map((entry) => (
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
      )}
    </div>
  )
}

type Draft = { version: string; date: string; title: string; changes: string }

function Editor({ initial, onDone }: { initial: ChangelogEntry[]; onDone: () => Promise<void> }) {
  const [drafts, setDrafts] = useState<Draft[]>(
    initial.map((e) => ({ ...e, changes: e.changes.join('\n') })),
  )
  const [busy, setBusy] = useState(false)

  const update = (index: number, patch: Partial<Draft>) =>
    setDrafts((list) => list.map((d, i) => (i === index ? { ...d, ...patch } : d)))

  function add() {
    const latest = drafts[0]?.version ?? '0.0'
    const [major, minor] = latest.split('.').map((n) => Number.parseInt(n, 10) || 0)
    setDrafts((list) => [
      { version: `${major}.${minor + 1}`, date: new Date().toISOString().slice(0, 10), title: '', changes: '' },
      ...list,
    ])
  }

  async function save() {
    setBusy(true)
    try {
      await saveChangelog({
        data: {
          entries: drafts.map((d) => ({
            version: d.version,
            date: d.date,
            title: d.title,
            changes: d.changes.split('\n').map((line) => line.trim()).filter(Boolean),
          })),
        },
      })
      toast.success('Dziennik zmian zapisany.')
      await onDone()
    } catch {
      toast.error('Nie udało się zapisać. Sprawdź numery wersji (unikalne), daty (RRRR-MM-DD) i tytuły.')
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    if (!window.confirm('Odrzucić wszystkie własne zmiany i wrócić do domyślnego dziennika?')) return
    setBusy(true)
    try {
      await resetChangelog()
      toast.success('Przywrócono domyślny dziennik.')
      await onDone()
    } catch {
      toast.error('Nie udało się przywrócić.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-8 space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void save()}>Zapisz</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={add}>Dodaj wpis</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void reset()}>Przywróć domyślny</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onDone()}>Anuluj</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        W polu zmian każda linijka to jeden punkt. Piszemy tylko to, co zmienia się w praktyce dla użytkowników; sprawy obsługi streszczamy zdaniem „Ulepszenia i nowe funkcje dla obsługi strony.”.
      </p>
      {drafts.map((draft, index) => (
        <div key={index} className="space-y-2 rounded-lg border bg-white p-4 shadow-sm">
          <div className="grid gap-2 sm:grid-cols-[6rem_9rem_1fr]">
            <Input value={draft.version} onChange={(e) => update(index, { version: e.target.value })} aria-label="Wersja" placeholder="3.5" />
            <Input value={draft.date} onChange={(e) => update(index, { date: e.target.value })} aria-label="Data" placeholder="RRRR-MM-DD" />
            <Input value={draft.title} onChange={(e) => update(index, { title: e.target.value })} aria-label="Tytuł" placeholder="Tytuł aktualizacji" />
          </div>
          <textarea
            value={draft.changes}
            onChange={(e) => update(index, { changes: e.target.value })}
            rows={Math.max(3, draft.changes.split('\n').length + 1)}
            aria-label="Zmiany, każda w osobnej linijce"
            className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
          />
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDrafts((list) => list.filter((_, i) => i !== index))}>
            Usuń wpis
          </Button>
        </div>
      ))}
    </div>
  )
}
