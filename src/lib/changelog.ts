/**
 * Dziennik zmian strony. Przy KAŻDEJ aktualizacji dopisz nowy wpis na początku listy
 * i podnieś `SITE_VERSION` (to ten numer widać w stopce).
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
    version: '2.8',
    date: '2026-11-21',
    title: 'PESEL widoczny dla administratorów',
    changes: [
      'Administratorzy widzą numery PESEL w tabeli od razu, bez klikania „odsłoń”. Kierownictwo nadal odsłania PESEL pojedynczo, a każde odsłonięcie trafia do dziennika.',
    ],
  },
  {
    version: '2.7',
    date: '2026-11-21',
    title: 'Tryb awaryjny, motywy kolorystyczne i dziennik zmian',
    changes: [
      'Tryb awaryjny: administrator może zamknąć rejestr dla odwiedzających z komunikatem o problemie technicznym.',
      'Osobę z kosza można dodać ponownie bez ręcznego usuwania jej z kosza (stary wpis jest wtedy usuwany automatycznie).',
      'Własne motywy kolorystyczne: gotowe zestawy oraz własny kolor, zapamiętywane w przeglądarce.',
      'Dziennik zmian strony (ta strona) i numer wersji w stopce.',
      'Statystyki dla administratorów: ranking najaktywniejszego kierownictwa.',
      'Alert i e-mail przy logowaniu z nowego urządzenia.',
      'Szerszy panel administratora i przycisk „Zamknij” przy otwartych panelach.',
    ],
  },
  {
    version: '2.6',
    date: '2026-11-20',
    title: 'Terminy ważności PWZ, statystyki i powiadomienia w panelu',
    changes: [
      'Terminy ważności PWZ: dożywotnio, 3 miesiące albo własna liczba dni lub miesięcy.',
      'Kierownictwo może złożyć wniosek o zmianę terminu (ze zrzutem ekranu); decyduje administrator.',
      'Statystyki odwiedzin całej strony dla administratorów.',
      'Czerwone kółko z liczbą oczekujących spraw na przyciskach i w nagłówku.',
    ],
  },
  {
    version: '2.5',
    date: '2026-11-19',
    title: 'Przeniesienie na Cloudflare',
    changes: [
      'Strona działa na Cloudflare Workers z bazą Neon Postgres.',
      'Własne logowanie kont administratorów i kierownictwa.',
    ],
  },
]

export const SITE_VERSION = CHANGELOG[0].version
