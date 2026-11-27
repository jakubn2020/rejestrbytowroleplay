import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requireSuperAdmin } from './auth-server'
import {
  DISCORD_ALERT_KINDS,
  DISCORD_ID_PATTERN,
  DISCORD_KIND_IDS,
  type DiscordConfig,
} from './discord-config'
import {
  discordWebhookConfigured,
  readDiscordConfig,
  sendDiscordTest,
  writeDiscordConfig,
} from './discord-server'
import { ROLE_ADMIN } from './registry'
import { logEvent } from './security-server'

export type DiscordSettings = {
  config: DiscordConfig
  /** Is DISCORD_WEBHOOK_URL set to a valid webhook? (The URL itself is never sent to the browser.) */
  webhookConfigured: boolean
  kinds: typeof DISCORD_ALERT_KINDS
}

/** Owner only: who is pinged and which alerts go to Discord. */
export const getDiscordSettings = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .handler(
    async (): Promise<DiscordSettings> => ({
      config: await readDiscordConfig(),
      webhookConfigured: discordWebhookConfigured(),
      kinds: DISCORD_ALERT_KINDS,
    }),
  )

const personSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1, 'Podaj nazwę osoby').max(50),
  discordId: z
    .string()
    .trim()
    .refine((v) => v === '' || DISCORD_ID_PATTERN.test(v), 'ID Discorda to ciąg cyfr (15–25), np. 123456789012345678'),
  enabled: z.boolean(),
})

const kindRuleSchema = z.object({
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  send: z.boolean(),
  ping: z.array(z.string().max(40)).max(30),
})

const configSchema = z.object({
  enabled: z.boolean(),
  criticalRole: z.object({
    enabled: z.boolean(),
    roleId: z
      .string()
      .trim()
      .refine((v) => v === '' || DISCORD_ID_PATTERN.test(v), 'ID roli Discorda to ciąg cyfr (15–25)'),
  }),
  people: z.array(personSchema).max(20),
  kinds: z.record(z.string(), kindRuleSchema),
})

/** Owner only: saves the Discord settings (what is sent, who is pinged for which alert). */
export const saveDiscordSettings = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(configSchema)
  .handler(async ({ data, context }) => {
    const ids = new Set(data.people.map((p) => p.id))
    if (ids.size !== data.people.length) {
      return { ok: false as const, error: 'Osoby na liście muszą mieć różne identyfikatory.' }
    }
    const kinds: DiscordConfig['kinds'] = {}
    for (const kind of DISCORD_KIND_IDS) {
      const rule = data.kinds[kind]
      kinds[kind] = {
        send: rule?.send ?? false,
        ping: (rule?.ping ?? []).filter((id) => ids.has(id)),
        ...(rule?.severity ? { severity: rule.severity } : {}),
      }
    }
    if (data.criticalRole.enabled && !DISCORD_ID_PATTERN.test(data.criticalRole.roleId)) {
      return { ok: false as const, error: 'Podaj ID roli Discorda (same cyfry), żeby włączyć ping roli przy alertach krytycznych.' }
    }
    await writeDiscordConfig({ enabled: data.enabled, criticalRole: data.criticalRole, people: data.people, kinds })
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'discord_settings',
      details: `Ważność alertów zmieniona: ${
        DISCORD_ALERT_KINDS.filter((k) => data.kinds[k.kind]?.severity && data.kinds[k.kind]?.severity !== k.severity)
          .map((k) => `${k.label} → ${data.kinds[k.kind]!.severity}`)
          .join('; ') || 'brak zmian względem domyślnych'
      }. Discord: ${data.enabled ? 'włączony' : 'wyłączony'}; ping roli przy alertach krytycznych: ${data.criticalRole.enabled ? `włączony (rola ${data.criticalRole.roleId})` : 'wyłączony'}; osoby: ${data.people
        .map((p) => `${p.label}${p.enabled ? '' : ' (wyłączona)'}`)
        .join(', ') || 'brak'}`,
    })
    return { ok: true as const }
  })

/** Owner only: sends a test message to the Discord channel (without pinging anybody). */
export const testDiscordWebhook = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .handler(async ({ context }) => sendDiscordTest(context.identity))
