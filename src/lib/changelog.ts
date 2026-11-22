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
    version: '3.3',
    date: '2026-11-22',
    title: 'Wygląd na życzenie, plakietki i numer zgłoszenia',
    changes: [
      'Nowe menu „Wygląd strony” w nagłówku: czcionka, zaokrąglenie rogów, czarny tryb OLED, wyłączanie animacji i przypięty górny pasek. Animacje wyłączają się też automatycznie przy ustawieniu „ogranicz ruch” w systemie.',
      'Górny pasek przypina się przy przewijaniu i robi się półprzezroczysty z rozmyciem (na szerokich ekranach).',
      'Płynne pojawianie się stron i paneli, licznik wpisów na stronie głównej liczy od zera, a puste listy mają ilustracje.',
      'Plakietka w trzech układach (pozioma, pionowa, mini) oraz podgląd plakietki na żywo przy edycji wpisu.',
      'Zgłoszenie błędu dostaje numer (ZG-…), po którym można sprawdzić jego status na stronie „Zgłoś błąd”.',
      'Właściciel: własne logo w nagłówku, wyłączanie znaku wodnego panelu oraz hasło tymczasowe dla konta (widoczne jednorazowo; istniejących haseł nie da się odczytać, bo są zapisane jako skrót).',
    ],
  },
  {
    version: '3.2',
    date: '2026-11-22',
    title: 'Dla pracodawców, regulamin i pulpit administratora',
    changes: [
      'Nowa strona „Dla pracodawców” z instrukcją weryfikacji wpisu w rejestrze.',
      'Regulamin i polityka prywatności (dostępne ze strony „Jak to działa”).',
      'Motywy sezonowe: kolory zmieniają się w okolicach świąt, jeśli nie wybrano własnej palety (można wyłączyć w menu kolorów).',
      'Panel: pasek „Co nowego” po zalogowaniu, gdy zmieni się wersja strony.',
      'Samouczek dla nowych kont kierownictwa (otwiera się sam raz, potem przyciskiem „Samouczek”).',
      'Administratorzy mają na górze panelu listę „Do zrobienia teraz”: wnioski, zgłoszenia, alerty, wygasające PWZ i kopie zapasowe.',
    ],
  },
  {
    version: '3.1',
    date: '2026-11-22',
    title: 'Szerokość tabeli na suwaku',
    changes: [
      'Szerokość tabeli z osobami w rejestrze można zmieniać suwakiem (700–3000 px). Ustawienie jest zapamiętywane osobno w przeglądarce każdej osoby, a reszta panelu się nie zmienia.',
      'Myśl dnia: przy przysłowiach nie pokazuje się już linijka z podpisem.',
    ],
  },
  {
    version: '3.0',
    date: '2026-11-22',
    title: 'Rozbudowane Centrum bezpieczeństwa',
    changes: [
      'Konta: blokada, zamrożenie na godziny, wymuszona zmiana hasła, jednorazowy link resetu hasła, historia logowań, unieważnienie wszystkich haseł, automatyczna blokada kont nieużywanych dłużej niż ustawiona liczba dni.',
      'Sesje: limit jednoczesnych sesji na konto, kończenie pojedynczej sesji, wylogowanie konta lub wszystkich.',
      'Adresy IP: lista blokad (pojedyncze adresy i zakresy), blokady czasowe z odliczaniem, automatyczny ban po serii nieudanych prób, biała lista panelu admina, ranking ruchu i wykres ruchu na minutę z wykrywaniem skoków.',
      'Wykrywanie: nowe urządzenie, nowy kraj, dwa kraje naraz, nietypowa pora, sieć Tor, skanowanie numerów PESEL, zgadywanie numerów PWZ, masowe sprawdzanie kodów QR, masowe usuwanie i zmiany statusów, zmiana PESEL.',
      'PESEL: próg alertu i dzienny limit odsłonięć na suwakach, rejestr „kto oglądał czyj PESEL”.',
      'Alerty mają poziomy ważności (niski, średni, wysoki, krytyczny) i można wysłać alarm próbny.',
      'Incydenty: przyciski „zamknij i wyloguj” oraz lockdown, plan reakcji, notatnik z osią czasu, zamrożenie dowodów, lista kontrolna, raport końcowy do pobrania.',
      'Kopie zapasowe rejestru z możliwością przywrócenia, ocena bezpieczeństwa 0–100.',
      'Dziennik zdarzeń zapisuje adres IP, a panel ma znak wodny z adresem e-mail zalogowanej osoby.',
    ],
  },
  {
    version: '2.9',
    date: '2026-11-21',
    title: 'Centrum bezpieczeństwa, odznaki i myśl dnia',
    changes: [
      'Centrum bezpieczeństwa dla właściciela: przegląd, wszystkie aktywne sesje, wylogowanie konta lub wszystkich użytkowników naraz, ostatnie zdarzenia.',
      'Strona weryfikacji pokazuje także termin ważności PWZ.',
      'Myśl dnia na stronie głównej.',
      'Odznaki dla kierownictwa za przyjęte wnioski (progi 1, 10, 50 i 100) oraz w rankingu aktywności.',
    ],
  },
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
