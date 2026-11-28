import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireAdmin, requireSuperAdmin } from './auth-server'
import { normalizeReasonTemplates, type ReasonTemplates } from './reason-templates'
import { ROLE_ADMIN } from './registry'
import { logEvent } from './security-server'
import { readSetting, writeSetting } from './site-settings-server'

const SETTING_KEY = 'reason_templates'

/** Admin: the ready-made reasons offered next to the reason fields. */
export const getReasonTemplates = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(async (): Promise<ReasonTemplates> => {
    try {
      const raw = await readSetting(SETTING_KEY)
      return normalizeReasonTemplates(raw ? JSON.parse(raw) : null)
    } catch {
      return normalizeReasonTemplates(null)
    }
  })

/** Owner: replaces the ready-made reasons (one list per category). */
export const saveReasonTemplates = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(
    z.object({
      reject: z.array(z.string().max(400)).max(50),
      suspend: z.array(z.string().max(400)).max(50),
      ipblock: z.array(z.string().max(400)).max(50),
    }),
  )
  .handler(async ({ data, context }) => {
    const templates = normalizeReasonTemplates(data)
    await writeSetting(SETTING_KEY, JSON.stringify(templates))
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'reason_templates',
      details: `Szablony powodów: odrzucenie ${templates.reject.length}, zawieszenie ${templates.suspend.length}, blokada IP ${templates.ipblock.length}`,
    })
    return { ok: true as const, templates }
  })
