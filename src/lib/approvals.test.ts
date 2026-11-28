import { describe, expect, it } from 'vitest'

import {
  applyApproval,
  approvalFingerprint,
  canApprove,
  defaultApprovalPolicy,
  isOpen,
  normalizeApprovalPolicy,
  type ApprovalRequest,
} from './approvals'

const base = (over: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  id: 'x',
  action: 'entry_delete',
  summary: 's',
  fingerprint: approvalFingerprint('entry_delete', 5),
  requestedBy: 'a@x.pl',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  required: 2,
  approvals: [],
  status: 'pending',
  ...over,
})

describe('approvals', () => {
  it('defaults to no approvals required', () => {
    expect(Object.values(defaultApprovalPolicy().rules).every((n) => n === 0)).toBe(true)
  })

  it('normalizes the policy', () => {
    const p = normalizeApprovalPolicy({ exemptEmails: [' A@x.pl ', 'a@x.pl', 'zly'], validHours: 9999, rules: { entry_delete: 7, entry_purge: -1, nope: 2 } })
    expect(p.exemptEmails).toEqual(['a@x.pl'])
    expect(p.validHours).toBe(168)
    expect(p.rules.entry_delete).toBe(3)
    expect(p.rules.entry_purge).toBe(0)
  })

  it('fingerprint ignores the order of ids', () => {
    expect(approvalFingerprint('entries_bulk', [3, 1, 2])).toBe(approvalFingerprint('entries_bulk', [1, 2, 3]))
  })

  it('the requester cannot approve, nobody can approve twice', () => {
    const r = base()
    expect(canApprove(r, 'A@x.pl')).toBe(false)
    expect(canApprove(r, 'b@x.pl')).toBe(true)
    const once = applyApproval(r, 'b@x.pl')
    expect(once.status).toBe('pending')
    expect(canApprove(once, 'b@x.pl')).toBe(false)
    const twice = applyApproval(once, 'c@x.pl')
    expect(twice.status).toBe('approved')
  })

  it('expired requests are closed', () => {
    const r = base({ expiresAt: new Date(Date.now() - 1000).toISOString() })
    expect(isOpen(r)).toBe(false)
    expect(applyApproval(r, 'b@x.pl')).toBe(r)
  })
})
