import {
  Actor, AuditEntry, Badge, DEFAULT_SETTINGS, EntryRequest, Examiner,
  Limits, Notification, RemovalRequest, Settings, Storage,
} from "./types";
import { assert, can } from "./permissions";

const uid = () => crypto.randomUUID();
const MIN = 60_000;

export function createExaminerService(db: Storage) {
  // ---------- pomocnicze ----------
  const load = {
    settings: () => db.get<Settings>("settings", DEFAULT_SETTINGS),
    examiners: () => db.get<Examiner[]>("examiners", []),
    entries: () => db.get<EntryRequest[]>("entryRequests", []),
    removals: () => db.get<RemovalRequest[]>("removalRequests", []),
    notifs: () => db.get<Notification[]>("notifications", []),
    audit: () => db.get<AuditEntry[]>("audit", []),
  };

  async function log(actor: Actor, action: string, targetId?: string, details?: string) {
    const a = await load.audit();
    a.unshift({ id: uid(), at: Date.now(), actorId: actor.id, action, targetId, details });
    await db.set("audit", a.slice(0, 2000));
  }

  async function notify(userId: string, text: string) {
    const n = await load.notifs();
    n.unshift({ id: uid(), userId, text, createdAt: Date.now(), read: false });
    await db.set("notifications", n.slice(0, 1000));
  }

  /** Zawieszenie z terminem wygasa automatycznie. */
  function effective(e: Examiner): Examiner {
    if (e.status === "zawieszony" && e.suspendedUntil && e.suspendedUntil <= Date.now()) {
      return { ...e, status: "aktywny", suspendedUntil: undefined, suspendReason: undefined };
    }
    return e;
  }

  async function getExaminer(id: string) {
    const e = (await load.examiners()).find((x) => x.id === id);
    return e ? effective(e) : undefined;
  }

  // ---------- ustawienia (właściciel) ----------
  async function getSettings() {
    const s = await load.settings();
    return { ...DEFAULT_SETTINGS, ...s, limits: { ...DEFAULT_SETTINGS.limits, ...s.limits } };
  }

  async function setLimits(actor: Actor, limits: Partial<Limits>) {
    assert(can.manageLimits(actor.role), "Limity zmienia tylko właściciel.");
    const s = await getSettings();
    for (const [k, v] of Object.entries(limits)) {
      if (!Number.isFinite(v) || (v as number) < 1) throw new Error(`Nieprawidłowa wartość: ${k}`);
    }
    s.limits = { ...s.limits, ...limits };
    await db.set("settings", s);
    await log(actor, "limity_zmienione", undefined, JSON.stringify(limits));
    return s;
  }

  async function setFrozen(actor: Actor, frozen: boolean) {
    assert(can.freeze(actor.role), "Tryb awaryjny włącza tylko właściciel.");
    const s = await getSettings();
    s.frozen = frozen;
    await db.set("settings", s);
    await log(actor, frozen ? "wnioski_zamrozone" : "wnioski_odmrozone");
    return s;
  }

  // ---------- konta egzaminatorów (moderator) ----------
  async function addExaminer(actor: Actor, input: { login: string; displayName: string }) {
    assert(can.addExaminer(actor.role));
    const { limits } = await getSettings();
    const list = await load.examiners();
    if (list.some((e) => e.login.toLowerCase() === input.login.toLowerCase() && e.status !== "usuniety"))
      throw new Error("Taki login już istnieje.");
    if (actor.role === "moderator_egzaminatorow") {
      const mine = list.filter((e) => e.createdBy === actor.id && e.status !== "usuniety").length;
      if (mine >= limits.examinersPerModerator)
        throw new Error(`Limit kont dodanych przez moderatora: ${limits.examinersPerModerator}.`);
    }
    const e: Examiner = {
      id: uid(), login: input.login.trim(), displayName: input.displayName.trim(),
      createdBy: actor.id, createdAt: Date.now(), status: "aktywny",
    };
    list.push(e);
    await db.set("examiners", list);
    await log(actor, "egzaminator_dodany", e.id, e.login);
    return e;
  }

  async function suspendExaminer(actor: Actor, id: string, reason: string, untilTs?: number) {
    assert(can.suspendExaminer(actor.role));
    if (!reason.trim()) throw new Error("Podaj powód zawieszenia.");
    if (untilTs && untilTs <= Date.now()) throw new Error("Termin musi być w przyszłości.");
    const list = await load.examiners();
    const e = list.find((x) => x.id === id);
    if (!e || e.status === "usuniety") throw new Error("Nie ma takiego egzaminatora.");
    e.status = "zawieszony";
    e.suspendReason = reason.trim();
    e.suspendedUntil = untilTs;
    await db.set("examiners", list);
    await log(actor, "egzaminator_zawieszony", id, reason);
    await notify(id, `Twoje konto zostało zawieszone: ${reason}${untilTs ? ` (do ${new Date(untilTs).toLocaleString("pl-PL")})` : ""}`);
    return e;
  }

  async function unsuspendExaminer(actor: Actor, id: string) {
    assert(can.suspendExaminer(actor.role));
    const list = await load.examiners();
    const e = list.find((x) => x.id === id);
    if (!e) throw new Error("Nie ma takiego egzaminatora.");
    e.status = "aktywny"; e.suspendedUntil = undefined; e.suspendReason = undefined;
    await db.set("examiners", list);
    await log(actor, "egzaminator_odwieszony", id);
    await notify(id, "Twoje konto zostało odwieszone.");
  }

  async function listExaminers(actor: Actor, filter?: "aktywny" | "zawieszony") {
    assert(can.viewModeratorPanel(actor.role));
    const list = (await load.examiners()).map(effective).filter((e) => e.status !== "usuniety");
    return filter ? list.filter((e) => e.status === filter) : list;
  }

  // ---------- wnioski o usunięcie konta (moderator składa, admin decyduje) ----------
  async function requestRemoval(actor: Actor, examinerId: string, reason: string) {
    assert(can.requestRemoval(actor.role), "Wniosek o usunięcie składa moderator egzaminatorów.");
    if (!reason.trim()) throw new Error("Podaj powód.");
    const { limits } = await getSettings();
    const all = await load.removals();
    const since = Date.now() - 24 * 60 * MIN;
    if (all.filter((r) => r.requestedBy === actor.id && r.createdAt >= since).length >= limits.moderatorRemovalRequestsPerDay)
      throw new Error(`Limit wniosków o usunięcie na dobę: ${limits.moderatorRemovalRequestsPerDay}.`);
    if (!(await getExaminer(examinerId))) throw new Error("Nie ma takiego egzaminatora.");
    if (all.some((r) => r.examinerId === examinerId && r.status === "oczekuje"))
      throw new Error("Wniosek o usunięcie tego konta już czeka.");
    const r: RemovalRequest = { id: uid(), examinerId, requestedBy: actor.id, reason: reason.trim(), status: "oczekuje", createdAt: Date.now() };
    all.push(r);
    await db.set("removalRequests", all);
    await log(actor, "wniosek_usuniecia_zlozony", examinerId, reason);
    return r;
  }

  async function decideRemoval(actor: Actor, requestId: string, approve: boolean) {
    assert(can.decideRemoval(actor.role));
    const all = await load.removals();
    const r = all.find((x) => x.id === requestId);
    if (!r || r.status !== "oczekuje") throw new Error("Wniosek nie istnieje lub został rozpatrzony.");
    r.status = approve ? "przyjety" : "odrzucony";
    r.decidedAt = Date.now(); r.decidedBy = actor.id;
    await db.set("removalRequests", all);
    if (approve) {
      const list = await load.examiners();
      const e = list.find((x) => x.id === r.examinerId);
      if (e) { e.status = "usuniety"; await db.set("examiners", list); }
    }
    await log(actor, approve ? "usuniecie_zatwierdzone" : "usuniecie_odrzucone", r.examinerId);
    await notify(r.requestedBy, `Wniosek o usunięcie konta został ${approve ? "zatwierdzony" : "odrzucony"}.`);
  }

  async function listRemovals(actor: Actor) {
    assert(can.viewModeratorPanel(actor.role));
    const all = await load.removals();
    return actor.role === "moderator_egzaminatorow" ? all.filter((r) => r.requestedBy === actor.id) : all;
  }

  // ---------- wnioski o wpis do rejestru (egzaminator) ----------
  /** Stan limitu do licznika na żywo: "Zostało 1/2, reset za 12:34". */
  async function rateStatus(examinerId: string) {
    const { limits } = await getSettings();
    const windowMs = limits.examinerRequestsWindowMin * MIN;
    const since = Date.now() - windowMs;
    const recent = (await load.entries()).filter((r) => r.examinerId === examinerId && r.createdAt >= since)
      .sort((a, b) => a.createdAt - b.createdAt);
    const used = recent.length;
    const resetInSec = used >= limits.examinerRequestsMax
      ? Math.max(1, Math.ceil((recent[used - limits.examinerRequestsMax].createdAt + windowMs - Date.now()) / 1000))
      : 0;
    return { used, max: limits.examinerRequestsMax, left: Math.max(0, limits.examinerRequestsMax - used), windowMin: limits.examinerRequestsWindowMin, resetInSec };
  }

  async function submitEntryRequest(actor: Actor, payload: Record<string, string>) {
    assert(can.submitEntryRequest(actor.role), "Wnioski o wpis składa egzaminator.");
    const s = await getSettings();
    if (s.frozen) throw new Error("Składanie wniosków jest chwilowo wstrzymane przez właściciela.");
    const ex = await getExaminer(actor.id);
    if (!ex || ex.status !== "aktywny")
      throw new Error(ex?.status === "zawieszony" ? `Konto zawieszone: ${ex.suspendReason ?? ""}` : "Konto nieaktywne.");
    const rs = await rateStatus(actor.id);
    if (rs.left <= 0) {
      const m = Math.floor(rs.resetInSec / 60), sec = String(rs.resetInSec % 60).padStart(2, "0");
      throw new Error(`Limit ${rs.max} wniosków na ${rs.windowMin} min. Spróbuj za ${m}:${sec}.`);
    }
    const r: EntryRequest = { id: uid(), examinerId: actor.id, payload, status: "oczekuje", createdAt: Date.now() };
    const all = await load.entries();
    all.push(r);
    await db.set("entryRequests", all);
    await log(actor, "wniosek_wpisu_zlozony", r.id);
    return r;
  }

  async function myEntryRequests(actor: Actor) {
    return (await load.entries()).filter((r) => r.examinerId === actor.id).sort((a, b) => b.createdAt - a.createdAt);
  }

  async function listEntryRequests(actor: Actor, status?: EntryRequest["status"]) {
    assert(can.decideEntryRequest(actor.role));
    const all = await load.entries();
    return (status ? all.filter((r) => r.status === status) : all).sort((a, b) => b.createdAt - a.createdAt);
  }

  async function decideEntryRequest(actor: Actor, requestId: string, approve: boolean, reason?: string) {
    assert(can.decideEntryRequest(actor.role));
    if (!approve && !reason?.trim()) throw new Error("Przy odrzuceniu podaj powód.");
    const all = await load.entries();
    const r = all.find((x) => x.id === requestId);
    if (!r || r.status !== "oczekuje") throw new Error("Wniosek nie istnieje lub został rozpatrzony.");
    r.status = approve ? "przyjety" : "odrzucony";
    r.rejectReason = approve ? undefined : reason!.trim();
    r.decidedAt = Date.now(); r.decidedBy = actor.id;
    await db.set("entryRequests", all);
    await log(actor, approve ? "wniosek_przyjety" : "wniosek_odrzucony", r.id, r.rejectReason);
    await notify(r.examinerId, approve ? "Twój wniosek został przyjęty ✔" : `Twój wniosek został odrzucony: ${r.rejectReason}`);
    return r;
  }

  /** Admin/właściciel: usuwa WSZYSTKIE wnioski jednej konkretnej osoby. */
  async function deleteAllRequestsOfPerson(actor: Actor, examinerId: string) {
    assert(can.deleteAllRequestsOfPerson(actor.role), "Tylko admin lub właściciel.");
    const all = await load.entries();
    const kept = all.filter((r) => r.examinerId !== examinerId);
    const removed = all.length - kept.length;
    await db.set("entryRequests", kept);
    await log(actor, "wnioski_osoby_usuniete", examinerId, `usunięto: ${removed}`);
    return { removed };
  }

  // ---------- powiadomienia ----------
  async function myNotifications(actor: Actor) {
    return (await load.notifs()).filter((n) => n.userId === actor.id);
  }
  async function markAllRead(actor: Actor) {
    const n = await load.notifs();
    n.forEach((x) => { if (x.userId === actor.id) x.read = true; });
    await db.set("notifications", n);
  }

  // ---------- audit log ----------
  async function listAudit(actor: Actor, limit = 200) {
    assert(can.viewAudit(actor.role));
    return (await load.audit()).slice(0, limit);
  }

  // ---------- odznaki i egzaminator miesiąca ----------
  async function badgesFor(examinerId: string): Promise<Badge[]> {
    const accepted = (await load.entries()).filter((r) => r.examinerId === examinerId && r.status === "przyjety").length;
    const tiers: [number, Badge][] = [
      [1, { id: "pierwszy", label: "Pierwszy wpis", description: "Pierwszy przyjęty wniosek" }],
      [10, { id: "10", label: "Rzetelny", description: "10 przyjętych wniosków" }],
      [50, { id: "50", label: "Filar rejestru", description: "50 przyjętych wniosków" }],
      [100, { id: "100", label: "Legenda", description: "100 przyjętych wniosków" }],
    ];
    const out = tiers.filter(([n]) => accepted >= n).map(([, b]) => b);
    const month = await examinerOfMonth();
    if (month?.examinerId === examinerId) out.push({ id: "miesiaca", label: "Egzaminator miesiąca", description: `${month.count} przyjętych w tym miesiącu` });
    return out;
  }

  async function examinerOfMonth() {
    const d = new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const counts = new Map<string, number>();
    for (const r of await load.entries())
      if (r.status === "przyjety" && (r.decidedAt ?? 0) >= start) counts.set(r.examinerId, (counts.get(r.examinerId) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? { examinerId: top[0], count: top[1] } : null;
  }

  return {
    getSettings, setLimits, setFrozen,
    addExaminer, suspendExaminer, unsuspendExaminer, listExaminers,
    requestRemoval, decideRemoval, listRemovals,
    rateStatus, submitEntryRequest, myEntryRequests, listEntryRequests, decideEntryRequest, deleteAllRequestsOfPerson,
    myNotifications, markAllRead, listAudit, badgesFor, examinerOfMonth,
  };
}

export type ExaminerService = ReturnType<typeof createExaminerService>;
