export type Role =
  | "wlasciciel"
  | "admin"
  | "kierownictwo"
  | "moderator_egzaminatorow"
  | "egzaminator";

export type Actor = { id: string; role: Role; name?: string };

export type ExaminerStatus = "aktywny" | "zawieszony" | "usuniety";

export type Examiner = {
  id: string;
  login: string;
  displayName: string;
  createdBy: string;
  createdAt: number;
  status: ExaminerStatus;
  suspendedUntil?: number; // timestamp; brak = bezterminowo
  suspendReason?: string;
};

export type RequestStatus = "oczekuje" | "przyjety" | "odrzucony";

export type EntryRequest = {
  id: string;
  examinerId: string;
  /** pola wniosku, np. { zawod, imieNazwisko, pwz } */
  payload: Record<string, string>;
  status: RequestStatus;
  rejectReason?: string;
  createdAt: number;
  decidedAt?: number;
  decidedBy?: string;
};

export type RemovalRequest = {
  id: string;
  examinerId: string;
  requestedBy: string;
  reason: string;
  status: RequestStatus;
  createdAt: number;
  decidedAt?: number;
  decidedBy?: string;
};

export type Notification = {
  id: string;
  userId: string;
  text: string;
  createdAt: number;
  read: boolean;
};

export type AuditEntry = {
  id: string;
  at: number;
  actorId: string;
  action: string;
  targetId?: string;
  details?: string;
};

/** Wszystkie limity ustawia właściciel. */
export type Limits = {
  examinerRequestsMax: number; // domyślnie 2
  examinerRequestsWindowMin: number; // domyślnie 20
  examinersPerModerator: number; // max kont egzaminatorów dodanych przez 1 moderatora
  moderatorRemovalRequestsPerDay: number;
};

export type Settings = {
  limits: Limits;
  /** tryb awaryjny: blokuje składanie nowych wniosków */
  frozen: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  limits: {
    examinerRequestsMax: 2,
    examinerRequestsWindowMin: 20,
    examinersPerModerator: 50,
    moderatorRemovalRequestsPerDay: 10,
  },
  frozen: false,
};

export type Badge = { id: string; label: string; description: string };

/** Adapter do Twojej bazy. Podłącz cokolwiek używasz w repo. */
export interface Storage {
  get<T>(key: string, fallback: T): Promise<T>;
  set<T>(key: string, value: T): Promise<void>;
}
