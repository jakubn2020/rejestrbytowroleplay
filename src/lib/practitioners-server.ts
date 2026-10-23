/** Server-only: inserting registry entries (used by admins and when a request is approved). */
import { eq, or } from 'drizzle-orm'

import { db } from '../../db'
import { practitioners } from '../../db/schema'
import { pwzFromPesel } from './registry'
import type { PractitionerData } from './schemas'

export const IN_TRASH =
  'Ta osoba (lub ten numer PWZ) znajduje się w koszu. Przywróć ją z kosza albo usuń trwale.'

/** An error message when the PESEL or the derived PWZ is already taken, otherwise null. */
export async function findClash(pesel: string, pwz: string): Promise<string | null> {
  const [clash] = await db
    .select({ pesel: practitioners.pesel, deletedAt: practitioners.deletedAt })
    .from(practitioners)
    .where(or(eq(practitioners.pesel, pesel), eq(practitioners.pwz, pwz)))
    .limit(1)
  if (!clash) return null
  if (clash.deletedAt) return IN_TRASH
  return clash.pesel === pesel
    ? 'Osoba o tym numerze PESEL jest już w rejestrze.'
    : `Numer PWZ ${pwz} jest już przypisany do innej osoby.`
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
