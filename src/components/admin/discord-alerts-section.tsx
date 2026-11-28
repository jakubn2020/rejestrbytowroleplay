import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ALERT_SEVERITIES,
  DISCORD_ID_PATTERN,
  SEVERITY_NAMES,
  type AlertSeverity,
  type DiscordConfig,
  type DiscordPerson,
} from '@/lib/discord-config'
import {
  getDiscordSettings,
  saveDiscordSettings,
  saveDiscordWebhook,
  testDiscordWebhook,
  type DiscordSettings,
} from '@/lib/discord.functions'

/**
 * Owner only: alerts on Discord (webhook). Choose which alerts are sent and who gets pinged for each one;
 * extra people can be added by hand (they need their numeric Discord user id).
 */
export function DiscordAlertsSection() {
  const [settings, setSettings] = useState<DiscordSettings | null>(null)
  const [config, setConfig] = useState<DiscordConfig | null>(null)
  const [busy, setBusy] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newId, setNewId] = useState('')
  const [webhookInput, setWebhookInput] = useState('')

  const load = useCallback(async () => {
    try {
      const loaded = await getDiscordSettings()
      setSettings(loaded)
      setConfig(loaded.config)
    } catch {
      toast.error('Nie udało się wczytać ustawień Discorda.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!settings || !config) return null

  const update = (patch: Partial<DiscordConfig>) => setConfig({ ...config, ...patch })
  const setPerson = (id: string, patch: Partial<DiscordPerson>) =>
    update({ people: config.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) })

  function togglePing(kind: string, personId: string, on: boolean) {
    if (!config) return
    const rule = config.kinds[kind] ?? { send: false, ping: [] }
    const ping = on ? [...new Set([...rule.ping, personId])] : rule.ping.filter((id) => id !== personId)
    setConfig({ ...config, kinds: { ...config.kinds, [kind]: { ...rule, ping } } })
  }

  function setSeverity(kind: string, severity: AlertSeverity | '') {
    if (!config) return
    const rule = config.kinds[kind] ?? { send: false, ping: [] }
    const { severity: _old, ...rest } = rule
    void _old
    setConfig({ ...config, kinds: { ...config.kinds, [kind]: severity ? { ...rest, severity } : rest } })
  }

  function setSend(kind: string, send: boolean) {
    if (!config) return
    const rule = config.kinds[kind] ?? { send: false, ping: [] }
    setConfig({ ...config, kinds: { ...config.kinds, [kind]: { ...rule, send } } })
  }

  function addPerson() {
    const label = newLabel.trim()
    const discordId = newId.trim()
    if (!label) return toast.error('Podaj nazwę osoby.')
    if (discordId && !DISCORD_ID_PATTERN.test(discordId)) {
      return toast.error('ID Discorda to ciąg cyfr (15–25 znaków).')
    }
    const id = `p${Date.now().toString(36)}`
    update({ people: [...config!.people, { id, label, discordId, enabled: true }] })
    setNewLabel('')
    setNewId('')
  }

  function removePerson(id: string) {
    update({
      people: config!.people.filter((p) => p.id !== id),
      kinds: Object.fromEntries(
        Object.entries(config!.kinds).map(([kind, rule]) => [kind, { ...rule, ping: rule.ping.filter((p) => p !== id) }]),
      ),
    })
  }

  async function save() {
    if (!config) return
    setBusy(true)
    try {
      const result = await saveDiscordSettings({ data: config })
      if (result.ok) toast.success('Zapisano ustawienia Discorda.')
      else toast.error(result.error)
    } catch {
      toast.error('Nie udało się zapisać. Sprawdź, czy ID Discorda są poprawnymi ciągami cyfr.')
    } finally {
      setBusy(false)
    }
  }

  async function saveWebhook(url: string) {
    setBusy(true)
    try {
      const result = await saveDiscordWebhook({ data: { url } })
      if (result.ok) {
        toast.success(url ? 'Zapisano adres webhooka.' : 'Usunięto adres webhooka z panelu.')
        setWebhookInput('')
        await load()
      } else toast.error(result.error)
    } catch {
      toast.error('Nie udało się zapisać adresu webhooka.')
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    try {
      const result = await testDiscordWebhook()
      if (result.ok) toast.success('Wiadomość próbna wysłana na Discorda.')
      else toast.error(result.error ?? 'Nie udało się wysłać wiadomości próbnej.')
    } catch {
      toast.error('Nie udało się wysłać wiadomości próbnej.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Powiadomienia na Discordzie</h3>
        <span
          className={`rounded px-2 py-0.5 text-xs ring-1 ${settings.webhookConfigured ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-red-50 text-red-800 ring-red-200'}`}
        >
          {settings.webhookConfigured
            ? `Webhook skonfigurowany (${settings.webhookSource === 'panel' ? 'z panelu' : 'ze zmiennej środowiskowej'}, ${settings.webhookHint})`
            : 'Brak webhooka'}
        </span>
      </div>
      <div className="space-y-2 rounded-md border p-3">
        <p className="text-sm font-medium">Adres webhooka</p>
        <p className="text-xs text-muted-foreground">
          Utwórz webhook na kanale Discorda (Ustawienia kanału → Integracje → Webhooki → Kopiuj adres URL webhooka) i wklej go
          tutaj. Adres jest tajny: po zapisaniu nie jest nigdzie wyświetlany, a nowy zastępuje stary. Adres z panelu ma
          pierwszeństwo przed zmienną środowiskową <code>DISCORD_WEBHOOK_URL</code>.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Adres webhooka Discorda"
            type="password"
            autoComplete="off"
            className="h-8 w-full max-w-md font-mono text-xs"
            maxLength={500}
            placeholder="https://discord.com/api/webhooks/…"
            value={webhookInput}
            onChange={(e) => setWebhookInput(e.target.value)}
          />
          <Button size="sm" disabled={busy || !webhookInput.trim()} onClick={() => void saveWebhook(webhookInput)}>
            Zapisz adres
          </Button>
          {settings.webhookSource === 'panel' && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void saveWebhook('')}>
              Usuń adres z panelu
            </Button>
          )}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={config.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
        Wysyłaj alerty bezpieczeństwa na Discorda
      </label>

      <div className="space-y-2 rounded-md border border-red-200 bg-red-50/50 p-3">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={config.criticalRole.enabled}
            onChange={(e) => update({ criticalRole: { ...config.criticalRole, enabled: e.target.checked } })}
          />
          Przy alercie krytycznym pinguj rolę na Discordzie
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="ID roli Discorda"
            className="h-8 w-60 font-mono text-xs"
            inputMode="numeric"
            maxLength={25}
            placeholder="ID roli (cyfry)"
            value={config.criticalRole.roleId}
            onChange={(e) => update({ criticalRole: { ...config.criticalRole, roleId: e.target.value.replace(/\s/g, '') } })}
          />
          {config.criticalRole.enabled && !DISCORD_ID_PATTERN.test(config.criticalRole.roleId) && (
            <span className="text-xs text-amber-700">podaj ID roli, inaczej nie zostanie oznaczona</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Alerty krytyczne są wysyłane zawsze, także gdy wyłączysz je w tabeli niżej. To, które alerty są krytyczne, ustawiasz
          w kolumnie „Ważność” (domyślnie m.in. atak siłowy z blokadą IP, logowania z dwóch krajów, masowe usuwanie, lockdown).
          Zmiana ważności działa wszędzie: na liście alertów w panelu, w temacie e-maila i na Discordzie. ID roli: Ustawienia serwera → Role → prawy przycisk na roli →
          „Kopiuj ID roli” (wymaga trybu dewelopera). Jeśli ping nie działa, sprawdź, czy rola ma włączone oznaczanie @wzmianką.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Osoby pingowane</p>
        <p className="text-xs text-muted-foreground">
          Discord pinguje po numerycznym ID, a nie po nazwie (Ustawienia Discorda → Zaawansowane → Tryb dewelopera, potem
          prawy przycisk na użytkowniku → „Kopiuj ID użytkownika”). Bez ID osoba nie zostanie oznaczona.
        </p>
        <ul className="space-y-2">
          {config.people.map((person) => {
            const idOk = DISCORD_ID_PATTERN.test(person.discordId)
            return (
              <li key={person.id} className="flex flex-wrap items-center gap-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={person.enabled} onChange={(e) => setPerson(person.id, { enabled: e.target.checked })} />
                  <span className="font-medium">{person.label}</span>
                </label>
                <Input
                  aria-label={`ID Discorda: ${person.label}`}
                  className="h-8 w-52 font-mono text-xs"
                  inputMode="numeric"
                  maxLength={25}
                  placeholder="ID Discorda (cyfry)"
                  value={person.discordId}
                  onChange={(e) => setPerson(person.id, { discordId: e.target.value.replace(/\s/g, '') })}
                />
                {!idOk && <span className="text-xs text-amber-700">brak ID: nie będzie oznaczana</span>}
                <Button size="sm" variant="ghost" onClick={() => removePerson(person.id)}>Usuń</Button>
              </li>
            )
          })}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="Nazwa nowej osoby" className="h-8 w-40" maxLength={50} placeholder="Nazwa osoby" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          <Input aria-label="ID Discorda nowej osoby" className="h-8 w-52 font-mono text-xs" inputMode="numeric" maxLength={25} placeholder="ID Discorda (cyfry)" value={newId} onChange={(e) => setNewId(e.target.value.replace(/\s/g, ''))} />
          <Button size="sm" variant="outline" onClick={addPerson}>Dodaj osobę</Button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Które alerty i kogo pingować</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Alert</th>
                <th className="px-2 font-medium">Ważność</th>
                <th className="px-2 font-medium">Wyślij</th>
                {config.people.map((p) => (
                  <th key={p.id} className="px-2 font-medium">Ping: {p.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {settings.kinds.map(({ kind, label, severity }) => {
                const rule = config.kinds[kind] ?? { send: false, ping: [] }
                return (
                  <tr key={kind} className="border-b last:border-0">
                    <td className="py-1.5 pr-2">{label}</td>
                    <td className="px-2">
                      <select
                        aria-label={`Ważność: ${label}`}
                        value={rule.severity ?? ''}
                        onChange={(e) => setSeverity(kind, e.target.value as AlertSeverity | '')}
                        className={`h-7 rounded-md border border-input px-1 text-xs ${(rule.severity ?? severity) === 'critical' ? 'bg-red-50 font-semibold text-red-800' : 'bg-white'}`}
                      >
                        <option value="">domyślna ({SEVERITY_NAMES[severity]})</option>
                        {ALERT_SEVERITIES.map((s) => (
                          <option key={s} value={s}>{SEVERITY_NAMES[s]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2">
                      <input type="checkbox" aria-label={`Wysyłaj: ${label}`} checked={rule.send} onChange={(e) => setSend(kind, e.target.checked)} />
                    </td>
                    {config.people.map((p) => (
                      <td key={p.id} className="px-2">
                        <input
                          type="checkbox"
                          aria-label={`Pinguj ${p.label}: ${label}`}
                          checked={rule.ping.includes(p.id)}
                          disabled={!rule.send}
                          onChange={(e) => togglePing(kind, p.id, e.target.checked)}
                        />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void save()}>Zapisz ustawienia Discorda</Button>
        <Button size="sm" variant="outline" disabled={busy || !settings.webhookConfigured} onClick={() => void test()}>
          Wyślij wiadomość próbną
        </Button>
      </div>
    </div>
  )
}
