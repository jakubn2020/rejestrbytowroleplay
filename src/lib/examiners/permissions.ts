import type { Role } from "./types";

const is = (r: Role, ...roles: Role[]) => roles.includes(r);

export const can = {
  manageLimits: (r: Role) => is(r, "wlasciciel"),
  freeze: (r: Role) => is(r, "wlasciciel"),
  addExaminer: (r: Role) => is(r, "moderator_egzaminatorow", "admin", "wlasciciel"),
  suspendExaminer: (r: Role) => is(r, "moderator_egzaminatorow", "admin", "wlasciciel"),
  requestRemoval: (r: Role) => is(r, "moderator_egzaminatorow"),
  decideRemoval: (r: Role) => is(r, "admin", "wlasciciel"),
  submitEntryRequest: (r: Role) => is(r, "egzaminator"),
  decideEntryRequest: (r: Role) => is(r, "admin", "wlasciciel"),
  deleteAllRequestsOfPerson: (r: Role) => is(r, "admin", "wlasciciel"),
  viewAudit: (r: Role) => is(r, "admin", "wlasciciel"),
  viewModeratorPanel: (r: Role) => is(r, "moderator_egzaminatorow", "admin", "wlasciciel"),
};

export class Forbidden extends Error {
  constructor(msg = "Brak uprawnień do tej akcji.") {
    super(msg);
  }
}
export function assert(ok: boolean, msg?: string): asserts ok {
  if (!ok) throw new Forbidden(msg);
}
