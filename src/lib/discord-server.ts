/**
 * Server-only: security alerts to a Discord channel through a webhook.
 *
 * The webhook URL is a secret and lives only in the DISCORD_WEBHOOK_URL environment variable
 * (never in the database or the panel). Everything else (what is sent, who is pinged) is set by the
 * owner in the panel and stored as JSON in the `settings` table.
 */
import {
  DISCORD_ID_PATTERN,
  normalizeDiscordConfig,
  type AlertSeverity,
  type DiscordConfig,
} from './discord-config'
import { clearSetting, readSetting, writeSetting } from './site-settings-server'

export const DISCORD_SETTING_KEY = 'discord_config'

export const DISCORD_WEBHOOK_SETTING_KEY = 'discord_webhook_url'

const WEBHOOK_PATTERN =
  /^https:\/\/(?:ptb\.|canary\.)?(?:discord|discordapp)\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w-]+\/?(?:\?[\w=&%.-]*)?$/

/** Cleans a pasted webhook address (spaces, quotes, <angle brackets>) and returns it when it is a Discord webhook, else null. */
export function normalizeWebhookUrl(raw: string | null | undefined): string | null {
  const url = (raw ?? '').trim().replace(/^["'<]+|["'>]+$/g, '').trim()
  return WEBHOOK_PATTERN.test(url) ? url : null
}

/** The address entered in the panel wins; the DISCORD_WEBHOOK_URL environment variable is the fallback. */
async function webhookUrl(): Promise<string | null> {
  try {
    const stored = normalizeWebhookUrl(await readSetting(DISCORD_WEBHOOK_SETTING_KEY))
    if (stored) return stored
  } catch (error) {
    console.error('Nie udało się odczytać adresu webhooka Discorda', error)
  }
  return normalizeWebhookUrl(process.env.DISCORD_WEBHOOK_URL)
}

/** Where the webhook comes from (never the address itself; only the last characters as a hint for the owner). */
export async function discordWebhookStatus(): Promise<{ configured: boolean; source: 'panel' | 'env' | null; hint: string }> {
  let stored: string | null = null
  try {
    stored = normalizeWebhookUrl(await readSetting(DISCORD_WEBHOOK_SETTING_KEY))
  } catch {
    stored = null
  }
  const env = normalizeWebhookUrl(process.env.DISCORD_WEBHOOK_URL)
  const url = stored ?? env
  return {
    configured: url !== null,
    source: stored ? 'panel' : env ? 'env' : null,
    hint: url ? `…${url.replace(/\?.*$/, '').replace(/\/$/, '').slice(-6)}` : '',
  }
}

export async function writeDiscordWebhook(url: string | null): Promise<void> {
  if (url) await writeSetting(DISCORD_WEBHOOK_SETTING_KEY, url)
  else await clearSetting(DISCORD_WEBHOOK_SETTING_KEY)
}

export async function readDiscordConfig(): Promise<DiscordConfig> {
  try {
    const raw = await readSetting(DISCORD_SETTING_KEY)
    return normalizeDiscordConfig(raw ? (JSON.parse(raw) as Partial<DiscordConfig>) : null)
  } catch (error) {
    console.error('Nie udało się odczytać ustawień Discorda', error)
    return normalizeDiscordConfig(null)
  }
}

/** The severity the owner chose for an alert kind, or `fallback` (built-in) when none / when the setting cannot be read. */
export async function effectiveSeverity(kind: string, fallback: AlertSeverity): Promise<AlertSeverity> {
  try {
    return (await readDiscordConfig()).kinds[kind]?.severity ?? fallback
  } catch {
    return fallback
  }
}

export async function writeDiscordConfig(config: DiscordConfig): Promise<void> {
  await writeSetting(DISCORD_SETTING_KEY, JSON.stringify(config))
}

const COLORS: Record<AlertSeverity, number> = {
  low: 0x64748b,
  medium: 0xf59e0b,
  high: 0xea580c,
  critical: 0xdc2626,
}
const ICONS: Record<AlertSeverity, string> = { low: 'ℹ️', medium: '⚠️', high: '🚨', critical: '🔥' }
const NAMES: Record<AlertSeverity, string> = { low: 'niski', medium: 'średni', high: 'wysoki', critical: 'KRYTYCZNY' }

async function post(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) {
      console.error('Discord odrzucił powiadomienie', response.status)
      return { ok: false, error: `Discord odpowiedział kodem ${response.status}` }
    }
    return { ok: true }
  } catch (error) {
    console.error('Nie udało się wysłać powiadomienia na Discorda', error)
    return { ok: false, error: 'Nie udało się połączyć z Discordem' }
  }
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * Sends one alert to Discord when the owner switched that kind on, pinging the chosen people.
 * Never throws and never blocks the action that raised the alert for long (5 s timeout).
 */
export async function sendDiscordAlert(alert: {
  kind: string
  severity: AlertSeverity
  details: string
  ip?: string | null
  identity?: string | null
  country?: string | null
}): Promise<void> {
  try {
    const url = await webhookUrl()
    if (!url) return
    const config = await readDiscordConfig()
    if (!config.enabled) return
    const rule = config.kinds[alert.kind]
    // The role is pinged on every critical alert, also when that kind is switched off in the table below.
    const roleId =
      alert.severity === 'critical' && config.criticalRole.enabled && DISCORD_ID_PATTERN.test(config.criticalRole.roleId)
        ? config.criticalRole.roleId
        : null
    // Unknown kinds fall back to "send when high or critical" so a new alert is never silently lost.
    const send = rule ? rule.send : alert.severity === 'high' || alert.severity === 'critical'
    if (!send && !roleId) return

    const pinged = (send ? (rule?.ping ?? []) : [])
      .map((id) => config.people.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p && p.enabled && DISCORD_ID_PATTERN.test(p.discordId)))
    const userIds = [...new Set(pinged.map((p) => p.discordId))]

    const fields = [
      alert.ip ? { name: 'Adres IP', value: `\`${alert.ip}\``, inline: true } : null,
      alert.identity ? { name: 'Konto', value: cut(alert.identity, 200), inline: true } : null,
      alert.country ? { name: 'Kraj', value: alert.country, inline: true } : null,
    ].filter(Boolean)

    await post(url, {
      username: 'Centralny Rejestr – alerty',
      content:
        [...(roleId ? [`<@&${roleId}>`] : []), ...userIds.map((id) => `<@${id}>`)].join(' ') || undefined,
      // Only the explicitly chosen role and people can be pinged; nothing in the alert text can mention anybody else.
      allowed_mentions: { parse: [], users: userIds, roles: roleId ? [roleId] : [] },
      embeds: [
        {
          title: `${ICONS[alert.severity]} Alert ${NAMES[alert.severity]}`,
          description: cut(alert.details, 1800),
          color: COLORS[alert.severity],
          fields,
          footer: { text: alert.kind },
          timestamp: new Date().toISOString(),
        },
      ],
    })
  } catch (error) {
    console.error('Powiadomienie na Discorda nie powiodło się', error)
  }
}

/** Test message from the panel (never pings anybody). Reports whether Discord accepted it. */
export async function sendDiscordTest(by: string): Promise<{ ok: boolean; error?: string }> {
  const url = await webhookUrl()
  if (!url) {
    return { ok: false, error: 'Brak poprawnego adresu webhooka. Wklej go w panelu albo ustaw zmienną DISCORD_WEBHOOK_URL.' }
  }
  return post(url, {
    username: 'Centralny Rejestr – alerty',
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: 'ℹ️ Wiadomość próbna',
        description: `Powiadomienia na Discorda działają. Wysłał(a): ${cut(by, 100)}.`,
        color: COLORS.low,
        timestamp: new Date().toISOString(),
      },
    ],
  })
}
