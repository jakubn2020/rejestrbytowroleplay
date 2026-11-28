import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { db } from '../../db'
import { users } from '../../db/schema'
import {
  APPROVAL_ACTIONS,
  applyApproval,
  canApprove,
  isOpen,
  normalizeApprovalPolicy,
  type ApprovalPolicy,
  type ApprovalRequest,
} from './approvals'
import {
  APPROVAL_POLICY_KEY,
  listApprovals,
  readApproval,
  readApprovalPolicy,
  saveApproval,
} from './approvals-server'
import { requireAdmin, requireSuperAdmin } from './auth-server'
import { ROLE_ADMIN } from './registry'
import { logEvent, raiseAlert } from './security-server'
import { writeSetting } from './site-settings-server'

export type ApprovalRow = ApprovalRequest & {
  /** Can the signed-in admin approve or reject this request right now? */
  canDecide: boolean
  mine: boolean
}

/** Admin: requests waiting for a decision, plus the admin's own recent ones. */
export const listApprovalRequests = createServerFn({ method: 'GET' })
  .middleware([requireAdmin])
  .handler(async ({ context }): Promise<ApprovalRow[]> => {
    const me = context.identity
    const all = await listApprovals()
    return all
      .filter((r) => isOpen(r) || r.requestedBy === me || r.status === 'approved')
      .slice(0, 100)
      .map((r) => ({ ...r, mine: r.requestedBy === me, canDecide: canApprove(r, me) }))
  })

/** Admin: approves another admin's request (never one's own, never twice). */
export const approveRequest = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const request = await readApproval(data.id)
    if (!request) return { ok: false as const, error: 'Nie znaleziono wniosku.' }
    if (!canApprove(request, context.identity)) {
      return { ok: false as const, error: 'Nie możesz zatwierdzić tego wniosku (własny, już zatwierdzony lub nieaktualny).' }
    }
    const next = applyApproval(request, context.identity)
    await saveApproval(next)
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'approval',
      target: request.summary,
      details: `Zgoda ${next.approvals.length}/${request.required} dla ${request.requestedBy}`,
    })
    return { ok: true as const, status: next.status }
  })

/** Admin: rejects another admin's request. */
export const rejectRequest = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const request = await readApproval(data.id)
    if (!request) return { ok: false as const, error: 'Nie znaleziono wniosku.' }
    if (!canApprove(request, context.identity)) {
      return { ok: false as const, error: 'Nie możesz odrzucić tego wniosku.' }
    }
    await saveApproval({ ...request, status: 'rejected', rejectedBy: context.identity })
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'approval',
      target: request.summary,
      details: `Odrzucono wniosek admina ${request.requestedBy}`,
    })
    await raiseAlert({
      kind: 'approval_requested',
      identity: context.identity,
      details: `${context.identity} odrzucił(a) wniosek ${request.requestedBy}: ${request.summary}`,
    })
    return { ok: true as const }
  })

/** Admin: withdraws one's own request. */
export const cancelRequest = createServerFn({ method: 'POST' })
  .middleware([requireAdmin])
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const request = await readApproval(data.id)
    if (!request || request.requestedBy !== context.identity) {
      return { ok: false as const, error: 'Nie znaleziono wniosku.' }
    }
    if (request.status === 'pending' || request.status === 'approved') {
      await saveApproval({ ...request, status: 'cancelled' })
    }
    return { ok: true as const }
  })

export type ApprovalSettings = { policy: ApprovalPolicy; actions: { key: string; label: string }[]; admins: string[] }

/** Owner: the policy (what needs approvals, how many, who is exempt) plus the list of admins to pick from. */
export const getApprovalPolicy = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .handler(async (): Promise<ApprovalSettings> => {
    const rows = await db.select({ email: users.email, roles: users.roles }).from(users)
    return {
      policy: await readApprovalPolicy(),
      actions: APPROVAL_ACTIONS.map((a) => ({ key: a.key, label: a.label })),
      admins: rows.filter((r) => r.roles.includes(ROLE_ADMIN)).map((r) => r.email.toLowerCase()).sort(),
    }
  })

/** Owner: saves the policy. */
export const saveApprovalPolicy = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(
    z.object({
      exemptEmails: z.array(z.string().max(200)).max(50),
      validHours: z.number().int().min(1).max(168),
      rules: z.record(z.string(), z.number().int().min(0).max(3)),
    }),
  )
  .handler(async ({ data, context }) => {
    const policy = normalizeApprovalPolicy(data)
    await writeSetting(APPROVAL_POLICY_KEY, JSON.stringify(policy))
    const active = Object.values(policy.rules).filter((n) => n > 0).length
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'approval',
      target: 'Zasada dwóch osób',
      details: `Zmieniono ustawienia: akcji objętych zgodami ${active}, wyznaczonych adminów ${policy.exemptEmails.length}`,
    })
    return { ok: true as const, policy }
  })
