import { describe, expect, it } from 'vitest'

import {
  COMBINABLE_ROLES,
  ROLE_ADMIN,
  ROLE_EXAMINER,
  ROLE_EXAM_MOD,
  ROLE_MANAGEMENT,
  ROLE_SUPERADMIN,
  hasPanelRole,
  isExamStaffOnly,
} from './registry'

describe('roles', () => {
  it('lets kierownictwo be a moderator or examiner too, but never an admin', () => {
    expect(COMBINABLE_ROLES).toEqual([ROLE_MANAGEMENT, ROLE_EXAMINER, ROLE_EXAM_MOD])
    expect(COMBINABLE_ROLES).not.toContain(ROLE_ADMIN)
    expect(COMBINABLE_ROLES).not.toContain(ROLE_SUPERADMIN)
  })

  it('sends kierownictwo + moderator to the full panel, plain moderators to the small one', () => {
    expect(isExamStaffOnly([ROLE_EXAM_MOD])).toBe(true)
    expect(isExamStaffOnly([ROLE_MANAGEMENT, ROLE_EXAM_MOD])).toBe(false)
    expect(hasPanelRole([ROLE_MANAGEMENT, ROLE_EXAM_MOD])).toBe(true)
  })
})
