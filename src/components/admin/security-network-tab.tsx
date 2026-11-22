import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { countryLabel, remaining } from '@/lib/download'
import { formatDateTime } from '@/lib/registry'
import {
  addIpRule,
  getLoginCountries,
  getTraffic,
  listIpRules,
  removeIpRule,
  setWhitelist,
  type CountryRow,
  type IpRuleRow,
  type TrafficInfo,
} from '@/lib/security-network.functions'

/** Owner only: blocked addresses and ranges, whitelist, traffic and countries. */
export function SecurityNetworkTab() {
  const [rules, setRules] = useState<{ block: IpRuleRow[]; allow: IpRuleRow[]; whitelistEnabled: boolean } | null>(null)
  const [traffic, setTraffic] = useState<TrafficInfo | null>(null)
  const [countries, setCountries] = useState<CountryRow[]>([])
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const [r, t, c] = await Promise.all([listIpRules(), getTraffic(), getLoginCountries()])
      setRules(r)
      setTraffic(t)
      setCountries(c)
      setNow(Date.now())
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [load])

  async function add(kind: 'block' | 'allow', rule: string, reason?: string, hours?: number) {
    setBusy(true)
    try {
      const result = await addIpRule({ data: { kind, rule, reason, hours } })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(kind === 'block' ? 'Adres zablokowany.' : 'Dodano do białej listy.')
      await load()
    } catch {
      toast.error('Nie udało się zapisać reguły.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: number) {
    setBusy(true)
    try {
      await removeIpRule({ data: { id } })
      toast.success('Usunięto.')
      await load()
    } catch {
      toast.error('Nie udało się usunąć.')
    } finally {
      setBusy(false)
    }
  }

  function submitBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    const hours = Number(fields.get('hours') || 0)
    void add('block', String(fields.get('rule')).trim(), String(fields.get('reason') || '') || undefined, hours > 0 ? hours : undefined).then(() => form.reset())
  }

  function submitAllow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    void add('allow', String(fields.get('rule')).trim()).then(() => form.reset())
  }

  async function toggleWhitelist(enabled: boolean) {
    if (enabled && !window.confirm('Włączyć białą listę? Admini zalogują się do panelu tylko z dozwolonych adresów (Ty jesteś wyłączony z ograniczenia).')) return
    try {
      const result = await setWhitelist({ data: { enabled } })
      if (!result.ok) toast.error(result.error)
      await load()
    } catch {
      toast.error('Nie udało się zmienić ustawienia.')
    }
  }

  if (failed) return <p role="alert" className="text-sm text-destructive">Nie udało się wczytać danych sieciowych.</p>
  if (rules === null || traffic === null) return <p className="text-muted-foreground">Wczytywanie…</p>

  const peak = Math.max(1, ...traffic.minutes.map((m) => m.hits))
  const spikes = traffic.minutes.filter((m) => m.hits >= traffic.spikeThreshold)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Ruch w wyszukiwarce: ostatnia godzina (zapytań na minutę)</h3>
        <div className="mt-2 flex h-28 items-end gap-px" role="img" aria-label="Wykres ruchu na minutę">
          {traffic.minutes.map((m) => (
            <div
              key={m.minute}
              title={`${m.minute.slice(11)} UTC: ${m.hits}`}
              className={`flex-1 rounded-t ${m.hits >= traffic.spikeThreshold ? 'bg-red-600' : 'bg-[var(--registry-navy)]/60'}`}
              style={{ height: `${Math.max(2, (m.hits / peak) * 100)}%` }}
            />
          ))}
        </div>
        <p className={`mt-1 text-xs ${spikes.length ? 'font-semibold text-red-700' : 'text-muted-foreground'}`}>
          {spikes.length
            ? `Wykryto skok ruchu w ${spikes.length} min (próg ${traffic.spikeThreshold} zapytań na minutę, czerwone słupki).`
            : `Brak skoków ruchu (próg ${traffic.spikeThreshold} na minutę). Odfiltrowane boty łącznie: ${traffic.botsFiltered}.`}
        </p>
      </div>

      <div>
        <h3 className="text-sm font-semibold">Adresy z największym ruchem (24 godz.)</h3>
        {traffic.topIps.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Brak danych.</p>
        ) : (
          <ul className="mt-2 divide-y rounded-md border text-sm">
            {traffic.topIps.map((row, index) => (
              <li key={row.ip} className="flex items-center justify-between gap-2 px-3 py-2">
                <span><span className="mr-2 font-mono text-muted-foreground">{index + 1}.</span><span className="font-mono">{row.ip}</span></span>
                <span className="flex items-center gap-3">
                  <span className="font-mono">{row.hits}</span>
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => void add('block', row.ip, 'Zablokowano z rankingu ruchu', 24)}>Zablokuj na 24 godz.</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold">Zablokowane adresy i zakresy ({rules.block.length})</h3>
        <form onSubmit={submitBlock} className="mt-2 grid gap-2 sm:grid-cols-[1.2fr_1.2fr_0.7fr_auto]">
          <Input name="rule" placeholder="Adres lub zakres, np. 203.0.113.0/24" required maxLength={60} />
          <Input name="reason" placeholder="Powód (opcjonalnie)" maxLength={200} />
          <Input name="hours" type="number" min={0} max={8760} placeholder="Godzin (puste = na stałe)" />
          <Button type="submit" disabled={busy}>Zablokuj</Button>
        </form>
        {rules.block.length > 0 && (
          <ul className="mt-2 divide-y rounded-md border text-sm">
            {rules.block.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div>
                  <p><span className="font-mono">{rule.rule}</span>{rule.auto && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800 ring-1 ring-amber-200">automatyczna</span>}</p>
                  <p className="text-xs text-muted-foreground">
                    {rule.reason ?? 'bez powodu'} · {rule.createdBy} · {formatDateTime(rule.createdAt)} · {remaining(rule.expiresAt, now)}
                  </p>
                </div>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void remove(rule.id)}>Odblokuj</Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Biała lista panelu admina ({rules.allow.length})</h3>
          <Button variant={rules.whitelistEnabled ? 'default' : 'outline'} size="sm" onClick={() => void toggleWhitelist(!rules.whitelistEnabled)}>
            {rules.whitelistEnabled ? 'Włączona: wyłącz' : 'Wyłączona: włącz'}
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Gdy włączona, administratorzy mogą korzystać z panelu tylko z tych adresów. Konto właściciela jest zawsze wyłączone z ograniczenia, więc nie możesz się zablokować.
        </p>
        <form onSubmit={submitAllow} className="mt-2 flex gap-2">
          <Input name="rule" placeholder="Adres lub zakres, np. 198.51.100.7" required maxLength={60} />
          <Button type="submit" variant="outline" disabled={busy}>Dodaj</Button>
        </form>
        {rules.allow.length > 0 && (
          <ul className="mt-2 divide-y rounded-md border text-sm">
            {rules.allow.map((rule) => (
              <li key={rule.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span className="font-mono">{rule.rule}</span>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void remove(rule.id)}>Usuń</Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold">Skąd logują się konta (30 dni)</h3>
        {countries.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Brak danych o krajach (kraj zapisuje się od tej wersji).</p>
        ) : (
          <ul className="mt-2 divide-y rounded-md border text-sm">
            {countries.map((row) => (
              <li key={row.country} className="flex justify-between gap-3 px-3 py-2">
                <span>{countryLabel(row.country)}</span>
                <span className="text-muted-foreground">logowań: <span className="font-mono text-foreground">{row.logins}</span> · kont: <span className="font-mono text-foreground">{row.accounts}</span></span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Sieć Tor jest rozpoznawana (kod „T1”) i zgłaszana alertem. Zwykłego VPN nie da się wiarygodnie wykryć.
        </p>
      </div>
    </div>
  )
}
