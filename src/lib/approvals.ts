/** Two-person rule ("cztery oczy"): shared types and pure helpers (no server imports). */

export const APPROVAL_ACTIONS = [
  { key: 'entry_delete', label: 'Usunięcie wpisu (do kosza)' },
  { key: 'entry_purge', label: 'Trwałe usunięcie wpisu z kosza' },
  { key: 'entries_bulk', label: 'Akcja zbiorcza na wpisach' },
  { key: 'management_add', label: 'Dodanie konta kierownictwa' },
  { key: 'management_delete', label: 'Usunięcie konta kierownictwa' },
  { key: 'management_password', label: 'Zmiana hasła konta kierownictwa' },
] as const

export type ApprovalActionKey = (typeof APPROVAL_ACTIONS)[number]['key']

export const MAX_REQUIRED_APPROVALS = 3
export const DEFAULT_APPROVAL_VALID_HOURS = 24

export type ApprovalPolicy = {
  /** Admins who may act without approvals (the owners always may). Lower-case e-mails. */
  exemptEmails: string[]
  /** How long a request waits for approvals, and how long an approved one can still be used. */
  validHours: number
  /** Approvals needed per action; 0 = the action needs no approval. */
  rules: Record<ApprovalActionKey, number>
}

export function defaultApprovalPolicy(): ApprovalPolicy {
  return {
    exemptEmails: [],
    validHours: DEFAULT_APPROVAL_VALID_HOURS,
    rules: Object.fromEntries(APPROVAL_ACTIONS.map((a) => [a.key, 0])) as Record<ApprovalActionKey, number>,
  }
}

export function normalizeApprovalPolicy(raw: unknown): ApprovalPolicy {
  const base = defaultApprovalPolicy()
  if (!raw || typeof raw !== 'object') return base
  const source = raw as Record<string, unknown>
  if (Array.isArray(source.exemptEmails)) {
    base.exemptEmails = [
      ...new Set(
        source.exemptEmails
          .filter((e): e is string => typeof e === 'string')
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e.includes('@')),
      ),
    ].slice(0, 50)
  }
  const hours = Number(source.validHours)
  if (Number.isFinite(hours)) base.validHours = Math.min(168, Math.max(1, Math.round(hours)))
  const rules = (source.rules && typeof source.rules === 'object' ? source.rules : {}) as Record<string, unknown>
  for (const { key } of APPROVAL_ACTIONS) {
    const n = Math.round(Number(rules[key]))
    if (Number.isFinite(n)) base.rules[key] = Math.min(MAX_REQUIRED_APPROVALS, Math.max(0, n))
  }
  return base
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'used' | 'cancelled'

export type ApprovalRequest = {
  id: string
  action: ApprovalActionKey
  /** Human-readable description of what is about to happen (never contains secrets). */
  summary: string
  /** Identifies this exact action (action + target); the requester repeats the action to use the approval. */
  fingerprint: string
  requestedBy: string
  createdAt: string
  expiresAt: string
  required: number
  approvals: { by: string; at: string }[]
  rejectedBy?: string
  status: ApprovalStatus
}

export const APPROVAL_KEY_PREFIX = 'approval:'

/** Action + target in one stable string. Secrets (passwords) must never be part of `target`. */
export function approvalFingerprint(action: ApprovalActionKey, target: string | number | (string | number)[]): string {
  const parts = Array.isArray(target) ? [...target].map(String).sort() : [String(target)]
  return `${action}|${parts.join(',')}`
}

export function isExpired(request: Pick<ApprovalRequest, 'expiresAt'>, now = Date.now()): boolean {
  return new Date(request.expiresAt).getTime() <= now
}

/** Is this request still waiting for a decision? */
export function isOpen(request: ApprovalRequest, now = Date.now()): boolean {
  return request.status === 'pending' && !isExpired(request, now)
}

/** Can this person approve? Never the requester, never twice, and only while the request is open. */
export function canApprove(request: ApprovalRequest, identity: string, now = Date.now()): boolean {
  const me = identity.toLowerCase()
  return (
    isOpen(request, now) &&
    request.requestedBy.toLowerCase() !== me &&
    !request.approvals.some((a) => a.by.toLowerCase() === me)
  )
}

/** Adds an approval and moves the request to "approved" once enough different people agreed. */
export function applyApproval(request: ApprovalRequest, identity: string, now = new Date()): ApprovalRequest {
  if (!canApprove(request, identity, now.getTime())) return request
  const approvals = [...request.approvals, { by: identity.toLowerCase(), at: now.toISOString() }]
  return { ...request, approvals, status: approvals.length >= request.required ? 'approved' : 'pending' }
}
