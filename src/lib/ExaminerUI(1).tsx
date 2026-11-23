import { useCallback, useEffect, useState } from "react";
import type {
  AuditEntry, Badge, EntryRequest, Examiner, Limits, Notification, RemovalRequest, Role, Settings,
} from "./examiners-types";
import "./examiners.css";

/** Co dostarczasz z serwera (server functions). Aktora bierz z sesji po stronie serwera, nie z przeglądarki. */
export type Api = {
  rateStatus(): Promise<{ used: number; max: number; left: number; windowMin: number; resetInSec: number }>;
  submitEntryRequest(payload: Record<string, string>): Promise<unknown>;
  myEntryRequests(): Promise<EntryRequest[]>;
  myNotifications(): Promise<Notification[]>;
  markAllRead(): Promise<void>;
  badgesFor(examinerId: string): Promise<Badge[]>;
  listExaminers(filter?: "aktywny" | "zawieszony"): Promise<Examiner[]>;
  addExaminer(i: { login: string; displayName: string }): Promise<unknown>;
  suspendExaminer(id: string, reason: string, untilTs?: number): Promise<unknown>;
  unsuspendExaminer(id: string): Promise<unknown>;
  requestRemoval(examinerId: string, reason: string): Promise<unknown>;
  listRemovals(): Promise<RemovalRequest[]>;
  decideRemoval(id: string, approve: boolean): Promise<unknown>;
  listEntryRequests(status?: EntryRequest["status"]): Promise<EntryRequest[]>;
  decideEntryRequest(id: string, approve: boolean, reason?: string): Promise<unknown>;
  deleteAllRequestsOfPerson(examinerId: string): Promise<{ removed: number }>;
  getSettings(): Promise<Settings>;
  setLimits(l: Partial<Limits>): Promise<unknown>;
  setFrozen(f: boolean): Promise<unknown>;
  listAudit(): Promise<AuditEntry[]>;
};

const fmt = (t: number) => new Date(t).toLocaleString("pl-PL");
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function useAction() {
  const [err, setErr] = useState("");
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setErr("");
    try { await fn(); after?.(); } catch (e) { setErr(e instanceof Error ? e.message : "Błąd"); }
  };
  return { err, run };
}

/* ---------- licznik limitu na żywo ---------- */
export function RateCounter({ api, refreshKey = 0 }: { api: Api; refreshKey?: number }) {
  const [s, setS] = useState<Awaited<ReturnType<Api["rateStatus"]>> | null>(null);
  const [left, setLeft] = useState(0);
  useEffect(() => { api.rateStatus().then((r) => { setS(r); setLeft(r.resetInSec); }); }, [api, refreshKey]);
  useEffect(() => {
    if (left <= 0) return;
    const t = setInterval(() => setLeft((x) => {
      if (x <= 1) { api.rateStatus().then((r) => { setS(r); setLeft(r.resetInSec); }); return 0; }
      return x - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [left > 0, api]);
  if (!s) return null;
  return (
    <p className={s.left ? "ex-ok" : "ex-warn"} aria-live="polite">
      Zostało {s.left}/{s.max} wniosków na {s.windowMin} min{left > 0 ? `, odblokowanie za ${mmss(left)}` : ""}.
    </p>
  );
}

/* ---------- dzwonek powiadomień ---------- */
export function NotificationBell({ api }: { api: Api }) {
  const [list, setList] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => api.myNotifications().then(setList), [api]);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  const unread = list.filter((n) => !n.read).length;
  return (
    <span className="ex-bell">
      <button className="ex-btn" aria-label={`Powiadomienia: ${unread} nowych`}
        onClick={async () => { setOpen(!open); if (!open && unread) { await api.markAllRead(); setTimeout(load, 1500); } }}>
        🔔{unread > 0 && <b>{unread}</b>}
      </button>
      {open && (
        <div className="ex-pop">
          {list.length === 0 && <p className="ex-muted">Brak powiadomień.</p>}
          {list.slice(0, 30).map((n) => (
            <div key={n.id} className="ex-row" style={{ display: "block", opacity: n.read ? 0.65 : 1 }}>
              {n.text}<div className="ex-muted">{fmt(n.createdAt)}</div>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

/* ---------- panel egzaminatora: składanie wniosku + historia + odznaki ---------- */
export function ExaminerDashboard({ api, userId }: { api: Api; userId: string }) {
  const [form, setForm] = useState({ zawod: "lekarz", imieNazwisko: "", pwz: "" });
  const [mine, setMine] = useState<EntryRequest[]>([]);
  const [badges, setBadges] = useState<Badge[]>([]);
  const [tick, setTick] = useState(0);
  const { err, run } = useAction();
  const reload = () => { api.myEntryRequests().then(setMine); setTick((x) => x + 1); };
  useEffect(() => { reload(); api.badgesFor(userId).then(setBadges); }, []);
  return (
    <div>
      <div className="ex-card">
        <h3>Wniosek o wpis do rejestru</h3>
        <RateCounter api={api} refreshKey={tick} />
        <div className="ex-row">
          <select value={form.zawod} onChange={(e) => setForm({ ...form, zawod: e.target.value })}>
            <option value="lekarz">lekarz</option><option value="pielegniarz">pielęgniarz</option><option value="ratownik">ratownik medyczny</option>
          </select>
          <input placeholder="Imię i nazwisko" value={form.imieNazwisko} onChange={(e) => setForm({ ...form, imieNazwisko: e.target.value })} />
          <input placeholder="Numer PWZ" value={form.pwz} onChange={(e) => setForm({ ...form, pwz: e.target.value })} />
          <button onClick={() => run(() => api.submitEntryRequest(form), () => { setForm({ ...form, imieNazwisko: "", pwz: "" }); reload(); })}>Wyślij wniosek</button>
        </div>
        {err && <p className="ex-bad" role="alert">{err}</p>}
      </div>

      <div className="ex-card">
        <h3>Twoje odznaki</h3>
        {badges.length === 0 ? <p className="ex-muted">Pierwsza odznaka po pierwszym przyjętym wniosku.</p>
          : badges.map((b) => <span key={b.id} className="ex-badge" title={b.description}>{b.label}</span>)}
      </div>

      <div className="ex-card">
        <h3>Twoje wnioski</h3>
        {mine.length === 0 && <p className="ex-muted">Nie złożyłeś jeszcze żadnego wniosku.</p>}
        {mine.map((r) => (
          <div key={r.id} className="ex-row">
            <span className={`ex-pill ${r.status === "przyjety" ? "ex-ok" : r.status === "odrzucony" ? "ex-bad" : "ex-warn"}`}>{r.status}</span>
            <span>{r.payload.imieNazwisko} ({r.payload.zawod}, PWZ {r.payload.pwz})</span>
            <span className="ex-muted">{fmt(r.createdAt)}</span>
            {r.rejectReason && <span className="ex-bad">Powód: {r.rejectReason}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- panel moderatora egzaminatorów ---------- */
export function ModeratorPanel({ api, role }: { api: Api; role: Role }) {
  const [list, setList] = useState<Examiner[]>([]);
  const [filter, setFilter] = useState<"" | "aktywny" | "zawieszony">("");
  const [nu, setNu] = useState({ login: "", displayName: "" });
  const [removals, setRemovals] = useState<RemovalRequest[]>([]);
  const { err, run } = useAction();
  const reload = useCallback(() => {
    api.listExaminers(filter || undefined).then(setList);
    api.listRemovals().then(setRemovals);
  }, [api, filter]);
  useEffect(reload, [reload]);

  const suspend = (e: Examiner) => {
    const reason = prompt(`Powód zawieszenia ${e.displayName}:`); if (!reason) return;
    const d = prompt("Do kiedy? (RRRR-MM-DD GG:MM) – puste = bezterminowo");
    const ts = d ? new Date(d.replace(" ", "T")).getTime() : undefined;
    run(() => api.suspendExaminer(e.id, reason, ts && !isNaN(ts) ? ts : undefined), reload);
  };
  const remove = (e: Examiner) => {
    const reason = prompt(`Powód wniosku o usunięcie konta ${e.displayName}:`); if (!reason) return;
    run(() => api.requestRemoval(e.id, reason), reload);
  };

  return (
    <div>
      <div className="ex-card">
        <h3>Dodaj egzaminatora</h3>
        <div className="ex-row">
          <input placeholder="Login" value={nu.login} onChange={(e) => setNu({ ...nu, login: e.target.value })} />
          <input placeholder="Nazwa wyświetlana" value={nu.displayName} onChange={(e) => setNu({ ...nu, displayName: e.target.value })} />
          <button onClick={() => run(() => api.addExaminer(nu), () => { setNu({ login: "", displayName: "" }); reload(); })}>Dodaj</button>
        </div>
      </div>

      <div className="ex-card">
        <div className="ex-row">
          <h3 style={{ margin: 0 }}>Egzaminatorzy</h3>
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="">wszyscy</option><option value="aktywny">aktywni</option><option value="zawieszony">zawieszeni</option>
          </select>
        </div>
        {err && <p className="ex-bad" role="alert">{err}</p>}
        {list.length === 0 && <p className="ex-muted">Brak egzaminatorów dla tego filtra.</p>}
        {list.map((e) => (
          <div key={e.id} className="ex-row">
            <strong>{e.displayName}</strong><span className="ex-muted">@{e.login}</span>
            <span className={`ex-pill ${e.status === "aktywny" ? "ex-ok" : "ex-warn"}`}>{e.status}</span>
            {e.status === "zawieszony" && <span className="ex-muted">{e.suspendReason}{e.suspendedUntil ? ` (do ${fmt(e.suspendedUntil)})` : ""}</span>}
            {e.status === "aktywny"
              ? <button onClick={() => suspend(e)}>Zawieś</button>
              : <button onClick={() => run(() => api.unsuspendExaminer(e.id), reload)}>Odwieś</button>}
            {role === "moderator_egzaminatorow" && <button onClick={() => remove(e)}>Wniosek o usunięcie</button>}
          </div>
        ))}
      </div>

      <div className="ex-card">
        <h3>Wnioski o usunięcie kont</h3>
        {removals.length === 0 && <p className="ex-muted">Brak wniosków.</p>}
        {removals.map((r) => (
          <div key={r.id} className="ex-row">
            <span className={`ex-pill ${r.status === "przyjety" ? "ex-ok" : r.status === "odrzucony" ? "ex-bad" : "ex-warn"}`}>{r.status}</span>
            <span>{list.find((e) => e.id === r.examinerId)?.displayName ?? r.examinerId}: {r.reason}</span>
            {(role === "admin" || role === "wlasciciel") && r.status === "oczekuje" && (<>
              <button onClick={() => run(() => api.decideRemoval(r.id, true), reload)}>Zatwierdź</button>
              <button onClick={() => run(() => api.decideRemoval(r.id, false), reload)}>Odrzuć</button>
            </>)}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- admin: wnioski o wpis + usuwanie wszystkich wniosków jednej osoby ---------- */
export function AdminRequestsPanel({ api }: { api: Api }) {
  const [reqs, setReqs] = useState<EntryRequest[]>([]);
  const [people, setPeople] = useState<Examiner[]>([]);
  const [target, setTarget] = useState("");
  const { err, run } = useAction();
  const reload = useCallback(() => { api.listEntryRequests().then(setReqs); api.listExaminers().then(setPeople); }, [api]);
  useEffect(reload, [reload]);
  const name = (id: string) => people.find((p) => p.id === id)?.displayName ?? id;
  const count = reqs.filter((r) => r.examinerId === target).length;

  return (
    <div>
      <div className="ex-card">
        <h3>Usuń wszystkie wnioski jednej osoby</h3>
        <div className="ex-row">
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">wybierz egzaminatora…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.displayName} (@{p.login})</option>)}
          </select>
          <button disabled={!target || count === 0}
            onClick={() => confirm(`Usunąć ${count} wniosków osoby ${name(target)}? Tej operacji nie cofniesz.`) &&
              run(() => api.deleteAllRequestsOfPerson(target), reload)}>
            Usuń wszystkie ({count})
          </button>
        </div>
        {err && <p className="ex-bad" role="alert">{err}</p>}
      </div>

      <div className="ex-card">
        <h3>Wnioski o wpis</h3>
        {reqs.length === 0 && <p className="ex-muted">Brak wniosków.</p>}
        {reqs.map((r) => (
          <div key={r.id} className="ex-row">
            <span className={`ex-pill ${r.status === "przyjety" ? "ex-ok" : r.status === "odrzucony" ? "ex-bad" : "ex-warn"}`}>{r.status}</span>
            <span>{r.payload.imieNazwisko} ({r.payload.zawod}, PWZ {r.payload.pwz})</span>
            <span className="ex-muted">od {name(r.examinerId)}, {fmt(r.createdAt)}</span>
            {r.status === "oczekuje" && (<>
              <button onClick={() => run(() => api.decideEntryRequest(r.id, true), reload)}>Przyjmij</button>
              <button onClick={() => { const why = prompt("Powód odrzucenia:"); if (why) run(() => api.decideEntryRequest(r.id, false, why), reload); }}>Odrzuć</button>
            </>)}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- właściciel: limity + tryb awaryjny ---------- */
export function OwnerSettings({ api }: { api: Api }) {
  const [s, setS] = useState<Settings | null>(null);
  const [l, setL] = useState<Limits | null>(null);
  const [saved, setSaved] = useState(false);
  const { err, run } = useAction();
  const load = () => api.getSettings().then((x) => { setS(x); setL(x.limits); });
  useEffect(() => { load(); }, []);
  if (!s || !l) return null;
  const field = (k: keyof Limits, label: string) => (
    <label className="ex-row" key={k}>
      <span style={{ minWidth: 280 }}>{label}</span>
      <input type="number" min={1} value={l[k]} onChange={(e) => setL({ ...l, [k]: Number(e.target.value) })} style={{ width: 90 }} />
    </label>
  );
  return (
    <div>
      <div className="ex-card">
        <h3>Limity</h3>
        {field("examinerRequestsMax", "Wnioski egzaminatora: maks. liczba")}
        {field("examinerRequestsWindowMin", "…w oknie czasowym (minuty)")}
        {field("examinersPerModerator", "Konta egzaminatorów na 1 moderatora")}
        {field("moderatorRemovalRequestsPerDay", "Wnioski o usunięcie kont na moderatora / dobę")}
        <button onClick={() => run(() => api.setLimits(l), () => { setSaved(true); setTimeout(() => setSaved(false), 2000); load(); })}>Zapisz limity</button>
        {saved && <span className="ex-ok"> Zapisano.</span>}
        {err && <p className="ex-bad" role="alert">{err}</p>}
      </div>
      <div className="ex-card">
        <h3>Tryb awaryjny</h3>
        <p className="ex-muted">Gdy włączony, nikt nie może złożyć nowego wniosku o wpis.</p>
        <button onClick={() => run(() => api.setFrozen(!s.frozen), load)}>{s.frozen ? "Odmroź wnioski" : "Zamroź wszystkie wnioski"}</button>
        {s.frozen && <span className="ex-warn"> Wnioski są zamrożone.</span>}
      </div>
    </div>
  );
}

/* ---------- dziennik zdarzeń ---------- */
export function AuditLog({ api }: { api: Api }) {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  useEffect(() => { api.listAudit().then(setRows); }, [api]);
  return (
    <div className="ex-card">
      <h3>Dziennik zdarzeń</h3>
      {rows.length === 0 && <p className="ex-muted">Brak zdarzeń.</p>}
      {rows.map((r) => (
        <div key={r.id} className="ex-row">
          <span className="ex-muted">{fmt(r.at)}</span><strong>{r.action.replaceAll("_", " ")}</strong>
          <span>wykonawca: {r.actorId}{r.targetId ? `, cel: ${r.targetId}` : ""}{r.details ? `, ${r.details}` : ""}</span>
        </div>
      ))}
    </div>
  );
}
