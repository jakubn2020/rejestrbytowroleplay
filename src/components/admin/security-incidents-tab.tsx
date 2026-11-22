import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { downloadText } from '@/lib/download'
import { INCIDENT_CHECKLIST, INCIDENT_PLAN } from '@/lib/incident-plan'
import { formatDateTime } from '@/lib/registry'
import {
  activateEmergency,
  addIncidentNote,
  closeIncident,
  createIncident,
  deactivateEmergency,
  getEmergencyState,
  getIncident,
  getIncidentReport,
  getIncidentSnapshot,
  listIncidents,
  setIncidentChecklist,
  type EmergencyState,
  type IncidentDetails,
  type IncidentRow,
} from '@/lib/security-ops.functions'

/** Owner only: emergency buttons, incident notebook, plan, checklist, evidence and report. */
export function SecurityIncidentsTab() {
  const [state, setState] = useState<EmergencyState | null>(null)
  const [incidents, setIncidents] = useState<IncidentRow[]>([])
  const [openId, setOpenId] = useState<number | null>(null)
  const [details, setDetails] = useState<IncidentDetails | null>(null)
  const [noteText, setNoteText] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const [s, i] = await Promise.all([getEmergencyState(), listIncidents()])
      setState(s)
      setIncidents(i)
    } catch {
      setFailed(true)
    }
  }, [])

  const loadDetails = useCallback(async (id: number) => {
    try {
      setDetails(await getIncident({ data: { id } }))
    } catch {
      toast.error('Nie udało się wczytać incydentu.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (openId !== null) void loadDetails(openId)
    else setDetails(null)
  }, [openId, loadDetails])

  async function emergency(mode: 'close' | 'lockdown') {
    const text =
      mode === 'lockdown'
        ? 'LOCKDOWN: zamknę rejestr, wylogowuję wszystkich, a logować będzie mógł się tylko właściciel. Zamrożę też dowody i otworzę incydent.'
        : 'Zamknąć rejestr dla odwiedzających i wylogować wszystkich użytkowników? Zamrożę też dowody i otworzę incydent.'
    if (!window.confirm(text)) return
    const reason = window.prompt('Powód (trafi do dziennika i incydentu):', '')
    if (reason === null) return
    setBusy(true)
    try {
      const result = await activateEmergency({ data: { mode, reason } })
      toast.success('Rejestr zabezpieczony. Otwarto incydent.')
      await load()
      setOpenId(result.incidentId)
    } catch {
      toast.error('Nie udało się włączyć trybu awaryjnego.')
    } finally {
      setBusy(false)
    }
  }

  async function end(reopen: boolean) {
    setBusy(true)
    try {
      await deactivateEmergency({ data: { reopen } })
      toast.success(reopen ? 'Lockdown wyłączony, rejestr otwarty.' : 'Lockdown wyłączony.')
      await load()
      if (openId !== null) await loadDetails(openId)
    } catch {
      toast.error('Nie udało się zmienić stanu.')
    } finally {
      setBusy(false)
    }
  }

  async function newIncident() {
    const title = window.prompt('Tytuł incydentu:', '')
    if (!title || title.trim().length < 3) return
    try {
      const result = await createIncident({ data: { title } })
      toast.success('Incydent otwarty, dowody zamrożone.')
      await load()
      setOpenId(result.id)
    } catch {
      toast.error('Nie udało się otworzyć incydentu.')
    }
  }

  async function addNote() {
    if (openId === null || !noteText.trim()) return
    try {
      await addIncidentNote({ data: { id: openId, text: noteText } })
      setNoteText('')
      await loadDetails(openId)
      await load()
    } catch {
      toast.error('Nie udało się dodać notatki.')
    }
  }

  async function toggleItem(id: string) {
    if (!details) return
    const next = details.checklist.includes(id)
      ? details.checklist.filter((x) => x !== id)
      : [...details.checklist, id]
    setDetails({ ...details, checklist: next })
    try {
      await setIncidentChecklist({ data: { id: details.incident.id, items: next } })
    } catch {
      toast.error('Nie udało się zapisać listy kontrolnej.')
    }
  }

  async function close() {
    if (openId === null) return
    try {
      await closeIncident({ data: { id: openId } })
      await loadDetails(openId)
      await load()
    } catch {
      toast.error('Nie udało się zamknąć incydentu.')
    }
  }

  async function report() {
    if (openId === null) return
    try {
      const result = await getIncidentReport({ data: { id: openId } })
      downloadText(`raport-incydent-${openId}.md`, result.report, 'text/markdown;charset=utf-8')
    } catch {
      toast.error('Nie udało się wygenerować raportu.')
    }
  }

  async function evidence() {
    if (openId === null) return
    try {
      const result = await getIncidentSnapshot({ data: { id: openId } })
      downloadText(`dowody-incydent-${openId}.json`, result.snapshot, 'application/json;charset=utf-8')
    } catch {
      toast.error('Nie udało się pobrać dowodów.')
    }
  }

  if (failed) return <p role="alert" className="text-sm text-destructive">Nie udało się wczytać danych.</p>
  if (state === null) return <p className="text-muted-foreground">Wczytywanie…</p>

  return (
    <div className="space-y-6">
      <div className="rounded-md border border-red-200 bg-red-50 p-4 dark:bg-red-950/30">
        <h3 className="text-sm font-semibold text-red-800 dark:text-red-300">Przyciski awaryjne</h3>
        <p className="mt-1 text-sm">
          Stan: rejestr {state.closed ? <strong>zamknięty</strong> : 'otwarty'}, lockdown {state.lockdown ? <strong>włączony</strong> : 'wyłączony'}.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="destructive" size="sm" disabled={busy} onClick={() => void emergency('close')}>
            Zamknij rejestr i wyloguj wszystkich
          </Button>
          <Button variant="destructive" size="sm" disabled={busy} onClick={() => void emergency('lockdown')}>
            LOCKDOWN (tylko właściciel może się logować)
          </Button>
          {(state.lockdown || state.closed) && (
            <>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void end(true)}>Zakończ i otwórz rejestr</Button>
              {state.lockdown && <Button variant="outline" size="sm" disabled={busy} onClick={() => void end(false)}>Wyłącz tylko lockdown</Button>}
            </>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold">Plan reakcji krok po kroku</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          {INCIDENT_PLAN.map((step) => (<li key={step}>{step}</li>))}
        </ol>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Incydenty ({incidents.length})</h3>
          <Button variant="outline" size="sm" onClick={() => void newIncident()}>Otwórz incydent (zamroź dowody)</Button>
        </div>
        {incidents.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Brak incydentów.</p>
        ) : (
          <ul className="mt-2 divide-y rounded-md border text-sm">
            {incidents.map((incident) => (
              <li key={incident.id}>
                <button type="button" onClick={() => setOpenId(openId === incident.id ? null : incident.id)} className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50">
                  <span><span className="font-mono text-muted-foreground">#{incident.id}</span> {incident.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {incident.status === 'open' ? 'otwarty' : 'zamknięty'} · {formatDateTime(incident.createdAt)} · notatek: {incident.notes}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {details && (
        <div className="space-y-4 rounded-md border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Incydent #{details.incident.id}: {details.incident.title}</h3>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void evidence()}>Pobierz dowody (JSON)</Button>
              <Button variant="outline" size="sm" onClick={() => void report()}>Pobierz raport</Button>
              {details.incident.status === 'open' && <Button size="sm" onClick={() => void close()}>Zamknij incydent</Button>}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold">Notatnik i oś czasu</h4>
            <ul className="mt-2 max-h-72 divide-y overflow-y-auto rounded-md border text-sm">
              {details.notes.length === 0 && <li className="px-3 py-2 text-muted-foreground">Brak notatek.</li>}
              {details.notes.map((n) => (
                <li key={n.id} className="px-3 py-2">
                  <p className="text-xs text-muted-foreground">{formatDateTime(n.createdAt)} · {n.author}</p>
                  <p>{n.text}</p>
                </li>
              ))}
            </ul>
            {details.incident.status === 'open' && (
              <div className="mt-2 flex gap-2">
                <Input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Co zrobiono / zauważono?" maxLength={1000} onKeyDown={(e) => { if (e.key === 'Enter') void addNote() }} />
                <Button size="sm" onClick={() => void addNote()}>Dodaj</Button>
              </div>
            )}
          </div>

          <div>
            <h4 className="text-sm font-semibold">Lista kontrolna po incydencie</h4>
            <ul className="mt-2 space-y-1 text-sm">
              {INCIDENT_CHECKLIST.map((item) => (
                <li key={item.id}>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={details.checklist.includes(item.id)} onChange={() => void toggleItem(item.id)} />
                    {item.label}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
