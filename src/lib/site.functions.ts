import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireAdmin } from './auth-server'
import { ROLE_ADMIN } from './registry'
import { notifyAdmins, logEvent } from './security-server'
import {
  MAINTENANCE_DEFAULT_MESSAGE,
  readMaintenance,
  writeMaintenance,
} from './site-settings-server'

/** Public: is the registry closed (emergency mode)? Used by the header banner. */
export const getSiteStatus = createServerFn({ method: 'GET' }).handler(async () =>
  readMaintenance(),
)

/** Admin only: closes or reopens the public registry ("problem techniczny"). */
export const setMaintenance = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(
    z.object({
      closed: z.boolean(),
      message: z.string().trim().max(300).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const message = data.message || MAINTENANCE_DEFAULT_MESSAGE
    await writeMaintenance(data.closed, message)
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'maintenance',
      target: data.closed ? 'Rejestr zamknięty' : 'Rejestr otwarty',
      details: data.closed ? message : undefined,
    })
    await notifyAdmins(
      data.closed ? 'Rejestr zamknięty (tryb awaryjny)' : 'Rejestr ponownie otwarty',
      `${context.identity} ${data.closed ? 'zamknął(-ęła) rejestr dla odwiedzających' : 'otworzył(a) rejestr dla odwiedzających'}.`,
    )
    return { closed: data.closed, message }
  })
