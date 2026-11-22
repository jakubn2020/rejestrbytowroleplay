const COMMON = new Set([
  'password', 'haslo', 'qwerty', 'admin', 'rejestr', 'medicare', 'zaq12wsx', 'test', 'abc123', 'letmein',
  'welcome', 'lekarz', 'pielegniarz', 'ratownik',
])

/** A password is weak when it is short, has little variety, is a well-known word or contains the e-mail name. */
export function isWeakPassword(password: string, email: string): boolean {
  if (password.length < 10) return true
  const classes = [/[a-ząćęłńóśźż]/.test(password), /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(password), /\d/.test(password), /[^A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(password)]
  if (classes.filter(Boolean).length < 2) return true
  const lower = password.toLowerCase()
  for (const word of COMMON) if (lower.includes(word)) return true
  const name = email.split('@')[0]?.toLowerCase() ?? ''
  if (name.length >= 4 && lower.includes(name)) return true
  if (/^(.)\1+$/.test(password)) return true
  return false
}
