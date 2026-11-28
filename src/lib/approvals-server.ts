/** Server-only: the two-person rule. A sensitive action by a non-exempt admin needs approvals first. */
import { eq, like } from 'drizzle-orm'

import { db } from '../../db'
import { settings, users } from '../../db/schema'
import {
  APPROVAL_KEY_PREFIX,
  approvalFingerprint,
  isExpired,
  normalizeApprovalPolicy,
  type ApprovalActionKey,
  type ApprovalPolicy,
  type ApprovalRequest,
  APPROVAL_ACTIONS,
} from './approvals'
import { ROLE_ADMIN } from './registry'
import { logEvent, raiseAlert } from './security-server'
import { readSetting, writeSetting } from './site-settings-server'

export const APPROVAL_POLICY_KEY = 'approval_policy'

export async function readApprovalPolicy(): Promise<ApprovalPolicy> {
  try {
    const raw = await readSetting(APPROVAL_POLICY_KEY)
    return normalizeApprovalPolicy(raw ? JSON.parse(raw) : null)
  } catch {
    return normalizeApprovalPolicy(null)
  }
}

function parseRequest(value: string): ApprovalRequest | null {
  try {
    const parsed = JSON.parse(value) as ApprovalRequest
    return parsed && typeof parsed.id === 'string' ? parsed : null
  } catch {
    return null
  }
}

export async function readApproval(id: string): Promise<ApprovalRequest | null> {
  const raw = await readSetting(APPROVAL_KEY_PREFIX + id)
  return raw ? parseRequest(raw) : null
}

export async function saveApproval(request: ApprovalRequest) {
  await writeSetting(APPROVAL_KEY_PREFIX + request.id, JSON.stringify(request))
}

/** All requests, newest first. Requests that expired while waiting are shown as such and cleaned up when very old. */
export async function listApprovals(): Promise<ApprovalRequest[]> {
  const rows = await db
    .select()
    .from(settings)
    .where(like(settings.key, `${APPROVAL_KEY_PREFIX}%`))
  const now = Date.now()
  const result: ApprovalRequest[] = []
  for (const row of rows) {
    const request = parseRequest(row.value)
    if (!request) continue
    // Housekeeping: drop requests that ended more than 7 days ago.
    if (now - new Date(request.expiresAt).getTime() > 7 * 86_400_000) {
      await db.delete(settings).where(eq(settings.key, row.key))
      continue
    }
    result.push(request)
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** How many other admins could approve a request by `identity` (owners are admins too). */
async function eligibleApprovers(identity: string): Promise<number> {
  const rows = await db.select({ email: users.email, roles: users.roles, locked: users.locked }).from(users)
  return rows.filter((u) => u.roles.includes(ROLE_ADMIN) && !u.locked && u.email.toLowerCase() !== identity).length
}

export const APPROVAL_PENDING_PREFIX = 'Wymagana zgoda innych adminów'

/**
 * Call at the start of a sensitive handler. Owners and designated admins pass at once, and so does any action
 * the owner left at 0 approvals. Everyone else needs `required` approvals from other admins: the first call
 * files a request (and throws), and once it is approved the same action, repeated by the same person, passes once.
 */
export async function gateAction(opts: {
  action: ApprovalActionKey
  /** What exactly is targeted (ids, e-mail). Never a password. */
  target: string | number | (string | number)[]
  summary: string
  user: { isSuperAdmin?: boolean }
  identity: string
}): Promise<void> {
  if (opts.user.isSuperAdmin) return
  const policy = await readApprovalPolicy()
  const identity = opts.identity.toLowerCase()
  const configured = policy.rules[opts.action] ?? 0
  if (configured <= 0 || policy.exemptEmails.includes(identity)) return

  const fingerprint = approvalFingerprint(opts.action, opts.target)
  const mine = (await listApprovals()).filter(
    (r) => r.fingerprint === fingerprint && r.requestedBy.toLowerCase() === identity && !isExpired(r),
  )

  const approved = mine.find((r) => r.status === 'approved')
  if (approved) {
    await saveApproval({ ...approved, status: 'used' })
    await logEvent({
      actor: identity,
      actorRole: ROLE_ADMIN,
      action: 'approval',
      target: opts.summary,
      details: `Wykonano za zgodą: ${approved.approvals.map((a) => a.by).join(', ')}`,
    })
    return
  }

  const pending = mine.find((r) => r.status === 'pending')
  if (pending) {
    throw new Error(`${APPROVAL_PENDING_PREFIX} (${pending.approvals.length}/${pending.required}). Poczekaj na decyzję.`)
  }

  const eligible = await eligibleApprovers(identity)
  const required = Math.min(configured, eligible)
  if (required <= 0) {
    throw new Error('Ta akcja wymaga zgody innych adminów, a nie ma ich teraz kto udzielić. Skontaktuj się z właścicielem.')
  }
  const now = new Date()
  const request: ApprovalRequest = {
    id: crypto.randomUUID(),
    action: opts.action,
    summary: opts.summary,
    fingerprint,
    requestedBy: identity,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + policy.validHours * 3_600_000).toISOString(),
    required,
    approvals: [],
    status: 'pending',
  }
  await saveApproval(request)
  const label = APPROVAL_ACTIONS.find((a) => a.key === opts.action)?.label ?? opts.action
  await logEvent({ actor: identity, actorRole: ROLE_ADMIN, action: 'approval', target: opts.summary, details: `Złożono wniosek: ${label} (potrzeba zgód: ${required})` })
  await raiseAlert({
    kind: 'approval_requested',
    identity,
    details: `${identity} prosi o zgodę: ${opts.summary} (potrzeba zgód: ${required}).`,
  })
  throw new Error(`${APPROVAL_PENDING_PREFIX}: wniosek wysłany (0/${required}). Gdy inni admini go zatwierdzą, powtórz tę akcję.`)
}

