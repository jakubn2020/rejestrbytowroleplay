import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireSuperAdmin } from './auth-server'
import { CHANGELOG, type ChangelogEntry } from './changelog'
import { ROLE_ADMIN } from './registry'
import { logEvent } from './security-server'
import { clearSetting, readSetting, writeSetting } from './site-settings-server'

const KEY = 'changelog_custom'

const entrySchema = z.object({
  version: z.string().trim().min(1).max(20),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().trim().min(1).max(120),
  changes: z.array(z.string().trim().min(1).max(400)).max(30),
})

type Stored = { entries: ChangelogEntry[]; deleted: string[] }

function compareVersions(a: string, b: string) {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** Saved edits on top of the built-in list; versions added in code later still show up. */
function merge(stored: Stored | null): ChangelogEntry[] {
  if (!stored) return CHANGELOG
  const known = new Set([...stored.entries.map((e) => e.version), ...stored.deleted])
  const fresh = CHANGELOG.filter((e) => !known.has(e.version))
  return [...stored.entries, ...fresh].sort((a, b) => compareVersions(a.version, b.version))
}

async function readStored(): Promise<Stored | null> {
  try {
    const raw = await readSetting(KEY)
    if (!raw) return null
    const parsed = z
      .object({ entries: z.array(entrySchema), deleted: z.array(z.string()) })
      .safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Public: the changelog (built-in list with the owner's edits applied). */
export const getChangelog = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ChangelogEntry[]> => merge(await readStored()),
)

/** Owner only: replaces the whole list with the edited one. */
export const saveChangelog = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(z.object({ entries: z.array(entrySchema).min(1).max(200) }))
  .handler(async ({ data, context }) => {
    const versions = new Set(data.entries.map((e) => e.version))
    if (versions.size !== data.entries.length) throw new Error('Numery wersji muszą być unikalne.')
    const deleted = CHANGELOG.filter((e) => !versions.has(e.version)).map((e) => e.version)
    await writeSetting(KEY, JSON.stringify({ entries: data.entries, deleted } satisfies Stored))
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'changelog',
      details: `Zapisano dziennik zmian (${data.entries.length} wpisów)`,
    })
    return { ok: true as const }
  })

/** Owner only: drops all edits and goes back to the built-in changelog. */
export const resetChangelog = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .handler(async ({ context }) => {
    await clearSetting(KEY)
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'changelog',
      details: 'Przywrócono domyślny dziennik zmian',
    })
    return { ok: true as const }
  })
