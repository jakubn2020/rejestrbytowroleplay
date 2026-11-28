/** Ready-made reasons ("szablony") that can be inserted with one click wherever a reason is typed. */

export const REASON_CATEGORIES = [
  { key: 'reject', label: 'Odrzucenie wniosku', hint: 'wniosek o wpis lub zmianę terminu ważności' },
  { key: 'suspend', label: 'Zawieszenie lub blokada konta', hint: 'egzaminatorzy, moderatorzy, konta' },
  { key: 'ipblock', label: 'Blokada adresu IP', hint: 'Centrum bezpieczeństwa → Adresy IP i ruch' },
] as const

export type ReasonCategory = (typeof REASON_CATEGORIES)[number]['key']
export type ReasonTemplates = Record<ReasonCategory, string[]>

export const MAX_TEMPLATES_PER_CATEGORY = 12
export const MAX_TEMPLATE_LENGTH = 150

export const DEFAULT_REASON_TEMPLATES: ReasonTemplates = {
  reject: [
    'Zrzut ekranu jest nieczytelny',
    'Na zrzucie ekranu nie widać, że osoba prosi o wpis',
    'Wpis tej osoby już istnieje',
    'Błędne dane (imię, nazwisko lub numer)',
    'Brak wymaganych informacji we wniosku',
  ],
  suspend: [
    'Naruszenie regulaminu',
    'Podejrzenie przejęcia konta',
    'Nieaktywność konta',
    'Zawieszenie do wyjaśnienia sprawy',
    'Na prośbę właściciela konta',
  ],
  ipblock: [
    'Podejrzana aktywność',
    'Atak siłowy na logowanie',
    'Zgadywanie numerów PESEL/PWZ',
    'Skanowanie strony przez bota',
    'Na prośbę właściciela',
  ],
}

/** Cleans stored or submitted templates: trims, drops empties and duplicates, cuts length and count. */
export function normalizeReasonTemplates(raw: unknown): ReasonTemplates {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const result = {} as ReasonTemplates
  for (const { key } of REASON_CATEGORIES) {
    const list = source[key]
    if (!Array.isArray(list)) {
      result[key] = [...DEFAULT_REASON_TEMPLATES[key]]
      continue
    }
    const cleaned = list
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().slice(0, MAX_TEMPLATE_LENGTH))
      .filter(Boolean)
    result[key] = [...new Set(cleaned)].slice(0, MAX_TEMPLATES_PER_CATEGORY)
  }
  return result
}
