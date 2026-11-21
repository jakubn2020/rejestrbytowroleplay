/** Server-only: inserting registry entries (used by admins and when a request is approved). */
import { and, eq, isNotNull, isNull, ne, or } from 'drizzle-orm'

import { db } from '../../db'
import { practitioners } from '../../db/schema'
import { pwzFromPesel } from './registry'
import { logEvent } from './security-server'
import type { PractitionerData } from './schemas'

export const IN_TRASH =
  'Ta osoba (lub ten numer PWZ) znajduje się w koszu. Przywróć ją z kosza albo usuń trwale.'

/**
 * An error message when the PESEL or the derived PWZ is taken by an entry that is in the registry,
 * otherwise null. Entries in the trash do not block: they are replaced when the new entry is saved.
 */
export async function findClash(pesel: string, pwz: string): Promise<string | null> {
  const [clash] = await db
    .select({ pesel: practitioners.pesel })
    .from(practitioners)
    .where(
      and(
        or(eq(practitioners.pesel, pesel), eq(practitioners.pwz, pwz)),
        isNull(practitioners.deletedAt),
      ),
    )
    .limit(1)
  if (!clash) return null
  return clash.pesel === pesel
    ? 'Osoba o tym numerze PESEL jest już w rejestrze.'
    : `Numer PWZ ${pwz} jest już przypisany do innej osoby.`
}

/** Permanently removes trashed entries with this PESEL or PWZ (so the number can be used again). */
export async function purgeTrashedClash(
  pesel: string,
  pwz: string,
  actor: string,
  exceptId?: number,
): Promise<void> {
  const rows = await db
    .delete(practitioners)
    .where(
      and(
        isNotNull(practitioners.deletedAt),
        or(eq(practitioners.pesel, pesel), eq(practitioners.pwz, pwz)),
        exceptId === undefined ? undefined : ne(practitioners.id, exceptId),
      ),
    )
    .returning({
      firstName: practitioners.firstName,
      lastName: practitioners.lastName,
      pwz: practitioners.pwz,
    })
  for (const row of rows) {
    await logEvent({
      actor,
      actorRole: 'system',
      action: 'purge',
      target: `${row.firstName} ${row.lastName} (PWZ ${row.pwz})`,
      details: 'Usunięto z kosza automatycznie, bo ten PESEL lub PWZ dodano ponownie',
    })
  }
}

export type InsertResult = { ok: true; pwz: string } | { ok: false; error: string }

export async function insertPractitioner(
  data: PractitionerData,
  createdBy: string,
): Promise<InsertResult> {
  const pwz = pwzFromPesel(data.pesel)
  const clash = await findClash(data.pesel, pwz)
  if (clash) return { ok: false, error: clash }
  try {
    await purgeTrashedClash(data.pesel, pwz, createdBy)
    await db.insert(practitioners).values({ ...data, pwz, createdBy })
  } catch (error) {
    console.error('Nie udało się dodać wpisu', error)
    return {
      ok: false,
      error:
        'Nie udało się zapisać wpisu. Sprawdź, czy ta osoba nie została właśnie dodana.',
    }
  }
  return { ok: true, pwz }
}
