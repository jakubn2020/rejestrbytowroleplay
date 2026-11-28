import { describe, expect, it } from 'vitest'

import { isWeakPassword, meetsPasswordPolicy } from './password-strength'

describe('password policy', () => {
  it('requires 10 characters, a digit and a special character', () => {
    expect(meetsPasswordPolicy('Abcdef1!gh')).toBe(true)
    expect(meetsPasswordPolicy('Abcdef1!g')).toBe(false) // 9 characters
    expect(meetsPasswordPolicy('Abcdefgh!!')).toBe(false) // no digit
    expect(meetsPasswordPolicy('Abcdefgh12')).toBe(false) // no special character
    expect(meetsPasswordPolicy('Abcdef 1gh')).toBe(false) // a space is not a special character
  })

  it('flags common words and the e-mail name as weak even when the policy is met', () => {
    expect(isWeakPassword('Haslo12345!', 'jan@example.com')).toBe(true)
    expect(isWeakPassword('Kowalski#2026x', 'kowalski@example.com')).toBe(true)
    expect(isWeakPassword('Zebra-Lampa-47', 'jan@example.com')).toBe(false)
  })
})
