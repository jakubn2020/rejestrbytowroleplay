/**
 * Wersje regulaminu i polityki prywatności. Przy każdej zmianie treści dopisz wpis NA POCZĄTKU
 * odpowiedniej listy (najnowsza wersja pierwsza); data i numer wyświetlają się na stronach.
 */
export type LegalVersion = { version: string; date: string; summary: string }

export const TERMS_VERSIONS: LegalVersion[] = [
  {
    version: '1.1',
    date: '2026-11-22',
    summary:
      'Formularz kontaktowy ma rodzaje spraw i numer zgłoszenia. Dodano zasady działań zbiorczych i cofania zmian oraz możliwość czasowego wyłączenia zgłoszeń i wniosków przez właściciela.',
  },
  { version: '1.0', date: '2026-11-22', summary: 'Pierwsza wersja regulaminu.' },
]

export const PRIVACY_VERSIONS: LegalVersion[] = [
  {
    version: '1.1',
    date: '2026-11-22',
    summary:
      'Dodano komunikat o plikach cookie oraz pełniejszą listę ustawień zapisywanych w przeglądarce. Doprecyzowano sposób składania próśb o usunięcie wpisu.',
  },
  { version: '1.0', date: '2026-11-22', summary: 'Pierwsza wersja polityki prywatności.' },
]
