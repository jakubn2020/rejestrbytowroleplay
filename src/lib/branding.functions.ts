import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireSuperAdmin } from './auth-server'
import { ROLE_ADMIN } from './registry'
import { logEvent } from './security-server'
import { clearSetting, readSetting, writeSetting } from './site-settings-server'

const LOGO_KEY = 'site_logo'
const WATERMARK_KEY = 'site_watermark'

export type Branding = {
  /** Image data URL of the custom logo, or null for the default (text only). */
  logo: string | null
  /** The e-mail watermark over the panel; only the owner can switch it off. */
  watermark: boolean
}

/** Public: the logo shown in the header and whether the panel watermark is on. */
export const getBranding = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Branding> => {
    try {
      const [logo, watermark] = await Promise.all([readSetting(LOGO_KEY), readSetting(WATERMARK_KEY)])
      return { logo: logo || null, watermark: watermark !== '0' }
    } catch {
      return { logo: null, watermark: true }
    }
  },
)

/** Owner only: logo (PNG, JPEG, WebP or SVG up to about 200 KB) and the watermark switch. */
export const saveBranding = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(
    z.object({
      logo: z
        .string()
        .max(300_000, 'Logo jest za duże (maksymalnie około 200 KB)')
        .regex(/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/, 'Dozwolone formaty: PNG, JPEG, WebP, SVG')
        .nullable(),
      watermark: z.boolean(),
    }),
  )
  .handler(async ({ data, context }) => {
    if (data.logo) await writeSetting(LOGO_KEY, data.logo)
    else await clearSetting(LOGO_KEY)
    await writeSetting(WATERMARK_KEY, data.watermark ? '1' : '0')
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'branding',
      details: `Logo: ${data.logo ? 'własne' : 'domyślne'}; znak wodny: ${data.watermark ? 'włączony' : 'wyłączony'}`,
    })
    return { ok: true as const }
  })
