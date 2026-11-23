import { isWeakPassword } from '@/lib/password-strength'

const CHECKS: { label: string; ok: (password: string, email: string) => boolean }[] = [
  { label: 'co najmniej 10 znaków', ok: (p) => p.length >= 10 },
  { label: 'małe i wielkie litery albo cyfra', ok: (p) => [/[a-ząćęłńóśźż]/.test(p), /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(p), /\d/.test(p), /[^A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(p)].filter(Boolean).length >= 2 },
  {
    label: 'bez popularnych słów i części adresu e-mail',
    ok: (p, e) => {
      const name = e.split('@')[0]?.toLowerCase() ?? ''
      const common = /password|haslo|qwerty|admin|rejestr|medicare|abc123|welcome|lekarz|pielegniarz|ratownik/i.test(p)
      return !common && !(name.length >= 4 && p.toLowerCase().includes(name))
    },
  },
]

/** Live strength meter for a new password: a bar and a checklist of what is still missing. */
export function PasswordStrengthMeter({ password, email = '' }: { password: string; email?: string }) {
  if (!password) return null
  const results = CHECKS.map((check) => check.ok(password, email))
  const passed = results.filter(Boolean).length
  const weak = isWeakPassword(password, email)
  const level = weak ? (passed >= 2 ? 1 : 0) : 2
  const labels = ['Słabe', 'Średnie', 'Mocne'] as const
  const colors = ['bg-rose-600', 'bg-amber-500', 'bg-emerald-600'] as const
  return (
    <div className="space-y-1" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-1.5 flex-1 rounded ${i <= level ? colors[level] : 'bg-muted'}`} />
        ))}
      </div>
      <p className="text-xs font-medium">Siła hasła: {labels[level]}</p>
      <ul className="text-xs text-muted-foreground">
        {CHECKS.map((check, i) => (
          <li key={check.label}>{results[i] ? '✓' : '✗'} {check.label}</li>
        ))}
      </ul>
    </div>
  )
}
