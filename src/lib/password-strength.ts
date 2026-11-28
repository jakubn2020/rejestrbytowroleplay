/** Minimum length of every new password (panel accounts, resets, examiner accounts, the create-user script). */
export const PASSWORD_MIN_LENGTH = 10

/** Shown wherever a new password is chosen. */
export const PASSWORD_RULES_TEXT =
  'Co najmniej 10 znaków, w tym cyfra i znak specjalny (np. ! ? # %).'

export const PASSWORD_RULES_ERROR = `Hasło musi mieć co najmniej ${PASSWORD_MIN_LENGTH} znaków, w tym cyfrę i znak specjalny.`

const COMMON = new Set([
  'password', 'haslo', 'qwerty', 'admin', 'rejestr', 'medicare', 'zaq12wsx', 'test', 'abc123', 'letmein',
  'welcome', 'lekarz', 'pielegniarz', 'ratownik',
])

export const hasDigit = (password: string) => /\d/.test(password)
export const hasSpecial = (password: string) => /[^A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ\s]/.test(password)
export const hasLetter = (password: string) => /[A-Za-ząćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(password)

/**
 * Hard requirements for a NEW password: at least 10 characters, a digit and a special character.
 * Enforced on the server (every place a password is set) and mirrored in the forms.
 */
export function meetsPasswordPolicy(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && hasDigit(password) && hasSpecial(password)
}

/**
 * A password is weak when it breaks the policy, is a well-known word, contains the e-mail name
 * or is one repeated character. Also used at sign-in to flag accounts that still have an old, weak password.
 */
export function isWeakPassword(password: string, email: string): boolean {
  if (!meetsPasswordPolicy(password) || !hasLetter(password)) return true
  const lower = password.toLowerCase()
  for (const word of COMMON) if (lower.includes(word)) return true
  const name = email.split('@')[0]?.toLowerCase() ?? ''
  if (name.length >= 4 && lower.includes(name)) return true
  if (/^(.)\1+$/.test(password)) return true
  return false
}
