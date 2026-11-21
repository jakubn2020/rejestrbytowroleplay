/** Server-only: site-wide switches stored in the `settings` table (e.g. the emergency "registry closed" mode). */
import { eq, inArray } from 'drizzle-orm'

import { db } from '../../db'
import { settings } from '../../db/schema'

export const MAINTENANCE_KEY = 'maintenance'
export const MAINTENANCE_MESSAGE_KEY = 'maintenance_message'

export const MAINTENANCE_DEFAULT_MESSAGE =
  'Rejestr jest chwilowo zamknięty z powodu problemu technicznego. Spróbuj ponownie za jakiś czas.'

export type Maintenance = { closed: boolean; message: string }

/** Is the public registry closed? A failed read counts as open so a database hiccup never locks everyone out. */
export async function readMaintenance(): Promise<Maintenance> {
  try {
    const rows = await db
      .select()
      .from(settings)
      .where(inArray(settings.key, [MAINTENANCE_KEY, MAINTENANCE_MESSAGE_KEY]))
    const closed = rows.find((r) => r.key === MAINTENANCE_KEY)?.value === '1'
    const message =
      rows.find((r) => r.key === MAINTENANCE_MESSAGE_KEY)?.value?.trim() ||
      MAINTENANCE_DEFAULT_MESSAGE
    return { closed, message }
  } catch (error) {
    console.error('Nie udało się odczytać trybu awaryjnego', error)
    return { closed: false, message: MAINTENANCE_DEFAULT_MESSAGE }
  }
}

async function writeSetting(key: string, value: string) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
}

export async function writeMaintenance(closed: boolean, message: string) {
  await writeSetting(MAINTENANCE_KEY, closed ? '1' : '0')
  await writeSetting(MAINTENANCE_MESSAGE_KEY, message)
}

export async function clearSetting(key: string) {
  await db.delete(settings).where(eq(settings.key, key))
}
