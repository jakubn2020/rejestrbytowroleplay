/**
 * Dziennik zmian strony. Przy KAŻDEJ aktualizacji dopisz nowy wpis na początku listy
 * i podnieś `SITE_VERSION` (to ten numer widać w stopce).
 *
 * Zasada treści: piszemy tylko to, co zmienia się w praktyce dla odwiedzających i użytkowników.
 * Zmiany dotyczące wyłącznie obsługi (administracja, bezpieczeństwo, panel) podsumowujemy jednym
 * zdaniem: „Ulepszenia i nowe funkcje dla obsługi strony.”, bez opisu, jakie to funkcje.
 * Właściciel może edytować dziennik na stronie /zmiany; zmiany zapisane w bazie nakładają się
 * na tę listę, a nowe wersje dopisane tutaj nadal się pojawiają.
 */
export type ChangelogEntry = {
  version: string
  /** yyyy-mm-dd */
  date: string
  title: string
  changes: string[]
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '3.7',
    date: '2026-11-24',
    title: 'Konta egzaminatorów',
    changes: ['Ulepszenia i nowe funkcje dla obsługi strony.'],
  },
  {
    version: '3.6',
    date: '2026-11-23',
    title: 'Moduł egzaminów (beta)',
    changes: ['Ulepszenia i nowe funkcje dla obsługi strony.'],
  },
  {
    version: '3.5',
    date: '2026-11-22',
    title: 'Kontakt i zgłoszenia, regulamin, cookies',
    changes: [
      'Strona „Zgłoś błąd” zmieniła się w „Kontakt i zgłoszenia”: wybierasz rodzaj sprawy (błąd w danych, prośba o usunięcie wpisu, pytanie, problem techniczny, inna sprawa).',
      'Regulamin i polityka prywatności pokazują numer wersji, datę i historię zmian.',
      'Jednorazowy komunikat o plikach cookie (strona używa tylko niezbędnej pamięci przeglądarki).',
      'Pod nagłówkiem może pojawiać się ogłoszenie od administracji strony.',
      'Ulepszenia i nowe funkcje dla obsługi strony.',
    ],
  },
  {
    version: '3.4',
    date: '2026-11-22',
    title: 'Tło strony głównej',
    changes: [
      'W menu „Wygląd strony” można wybrać tło strony głównej: bez tła, kropki, siatka albo łagodny gradient.',
      'Ulepszenia i nowe funkcje dla obsługi strony.',
    ],
  },
  {
    version: '3.3',
    date: '2026-11-22',
    title: 'Wygląd na życzenie i numer zgłoszenia',
    changes: [
      'Nowe menu „Wygląd strony” w nagłówku: czcionka, zaokrąglenie rogów, czarny tryb OLED, wyłączanie animacji i przypięty górny pasek. Animacje wyłączają się też automatycznie przy ustawieniu „ogranicz ruch” w systemie.',
      'Górny pasek przypina się przy przewijaniu i robi się półprzezroczysty z rozmyciem (na szerokich ekranach).',
      'Płynne pojawianie się stron, a liczniki na stronie głównej liczą od zera.',
      'Zgłoszenie błędu dostaje numer (ZG-…), po którym można sprawdzić jego status na stronie „Zgłoś błąd”.',
      'Ulepszenia i nowe funkcje dla obsługi strony.',
    ],
  },
  {
    version: '3.2',
    date: '2026-11-22',
    title: 'Dla pracodawców, regulamin i motywy sezonowe',
    changes: [
      'Nowa strona „Dla pracodawców” z instrukcją weryfikacji wpisu w rejestrze.',
      'Regulamin i polityka prywatności (dostępne ze strony „Jak to działa”).',
      'Motywy sezonowe: kolory zmieniają się w okolicach świąt, jeśli nie wybrano własnej palety (można wyłączyć w menu kolorów).',
      'Ulepszenia i nowe funkcje dla obsługi strony.',
    ],
  },
  {
    version: '3.1',
    date: '2026-11-22',
    title: 'Myśl dnia',
    changes: [
      'Myśl dnia: przy przysłowiach nie pokazuje się już linijka z podpisem.',
      'Ulepszenia i nowe funkcje dla obsługi strony.',
    ],
  },
  {
    version: '3.0',
    date: '2026-11-22',
    title: 'Bezpieczeństwo',
    changes: ['Ulepszenia i nowe funkcje dla obsługi strony.'],
  },
  {
    version: '2.9',
    date: '2026-11-21',
    title: 'Termin ważności na stronie weryfikacji i myśl dnia',
    changes: [
      'Strona weryfikacji pokazuje także termin ważności PWZ.',
      'Myśl dnia na stronie głównej.',
      'Ulepszenia i nowe funkcje dla obsługi strony.',
    ],
  },
  {
    version: '2.8',
    date: '2026-11-21',
    title: 'Poprawki',
    changes: ['Ulepszenia i nowe funkcje dla obsługi strony.'],
  },
  {
    version: '2.7',
    date: '2026-11-21',
    title: 'Motywy kolorystyczne i dziennik zmian',
    changes: [
      'Własne motywy kolorystyczne: gotowe zestawy oraz własny kolor, zapamiętywane w przeglądarce.',
      'Dziennik zmian strony (ta strona) i numer wersji w stopce.',
      'W razie problemu technicznego strona może tymczasowo pokazać komunikat o zamknięciu rejestru.',
      'Ulepszenia i nowe funkcje dla obsługi strony.',
    ],
  },
  {
    version: '2.6',
    date: '2026-11-20',
    title: 'Terminy ważności PWZ',
    changes: [
      'Wpisy mają termin ważności PWZ: dożywotnio, 3 miesiące albo inny okres. Po jego upływie wpis przestaje być aktywny.',
      'Ulepszenia i nowe funkcje dla obsługi strony.',
    ],
  },
  {
    version: '2.5',
    date: '2026-11-19',
    title: 'Nowa infrastruktura',
    changes: [
      'Strona działa na nowej, szybszej infrastrukturze (Cloudflare i baza Neon).',
      'Ulepszenia i nowe funkcje dla obsługi strony.',
    ],
  },
]

export const SITE_VERSION = CHANGELOG[0].version
