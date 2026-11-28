import { describe, expect, it } from 'vitest'

import { DEFAULT_REASON_TEMPLATES, MAX_TEMPLATES_PER_CATEGORY, normalizeReasonTemplates } from './reason-templates'

describe('reason templates', () => {
  it('falls back to the defaults for missing categories', () => {
    expect(normalizeReasonTemplates(null)).toEqual(DEFAULT_REASON_TEMPLATES)
    expect(normalizeReasonTemplates({ reject: ['  A  ', '', 'A', 'B'] }).reject).toEqual(['A', 'B'])
    expect(normalizeReasonTemplates({ reject: ['A'] }).suspend).toEqual(DEFAULT_REASON_TEMPLATES.suspend)
  })

  it('keeps an emptied category empty and caps the length and count', () => {
    expect(normalizeReasonTemplates({ ipblock: [] }).ipblock).toEqual([])
    const many = Array.from({ length: 30 }, (_, i) => `powód ${i}`)
    expect(normalizeReasonTemplates({ suspend: many }).suspend).toHaveLength(MAX_TEMPLATES_PER_CATEGORY)
    expect(normalizeReasonTemplates({ suspend: ['x'.repeat(400)] }).suspend[0]).toHaveLength(150)
  })
})
