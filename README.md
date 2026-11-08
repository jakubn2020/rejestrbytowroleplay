# Centralny Rejestr Lekarzy, Pielęgniarzy i Ratowników Medycznych

Fikcyjny rejestr zawodów medycznych na potrzeby roleplayu. Każdy może wyszukać osobę po numerze PESEL, numerze PWZ albo pełnym imieniu i nazwisku. Wynik pokazuje wyłącznie imię i nazwisko, numer PWZ, zawód i specjalizację (dla ratowników medycznych zawsze „nd.”). PESEL nigdy nie jest pokazywany publicznie.

Administrator loguje się na stronie `/admin` i dodaje lub usuwa osoby. Numer PWZ wyliczany jest automatycznie: ostatnie 7 cyfr PESEL-u (PESEL może mieć dowolną liczbę cyfr; krótszy niż 7 cyfr jest dopełniany zerami z lewej), a jeśli wynik zaczyna się od 0, pierwsza cyfra zamieniana jest na 1.

Dostępne zawody: lekarz rezydent, lekarz, lekarz specjalista, ratownik medyczny, pielęgniarz.

## Technologie

- TanStack Start (React 19), Tailwind CSS 4, shadcn/ui
- Netlify Database (Postgres) + Drizzle ORM — przechowywanie wpisów
- Netlify Identity — logowanie administratora (rola `admin`)

## Konfiguracja konta administratora

1. W panelu Netlify: **Project configuration → Identity** ustaw rejestrację na **Invite only**.
2. W zakładce **Identity** kliknij **Invite users** i podaj swój e-mail.
3. Kliknij link z maila — otworzy się `/admin`, gdzie ustawisz hasło.
4. W Netlify otwórz swojego użytkownika w Identity i w polu **Roles** dodaj `admin`.
5. Zaloguj się ponownie na `/admin`.

## Uruchomienie lokalne

```bash
pnpm install
netlify dev
```

Migracje bazy znajdują się w `netlify/database/migrations/` i są stosowane automatycznie przy wdrożeniu. Po zmianie `db/schema.ts` wygeneruj nową migrację: `npx drizzle-kit generate --name <nazwa>`.

## Role

- `admin` – dodaje osoby bezpośrednio, usuwa je (do kosza na 30 dni), edytuje PESEL, specjalizację, status i ręcznie ustawia numer PWZ (PWZ musi mieć 7 cyfr i być unikalny). Tylko `admin` widzi przyciski: „Dodaj kierownictwo”, „Konta kierownictwa” (lista, reset hasła, usuwanie), „Wnioski” (akceptacja lub odrzucenie wniosków kierownictwa), „Kosz” i „Dziennik zdarzeń” (z filtrami i eksportem CSV).
- `kierownictwo` – widzi numery PESEL, wyszukuje pracowników i tworzy plakietki. Nie dodaje osób bezpośrednio: składa **wniosek** (imię, nazwisko, PESEL, zawód i **zrzut ekranu wiadomości**, w której ta osoba prosi o wpis), najwyżej jeden na 5 minut (limit liczony po stronie serwera). Wniosek akceptuje lub odrzuca admin, oglądając zrzut ekranu; po akceptacji wpis powstaje automatycznie (w rejestrze figuruje jako dodany przez osobę z kierownictwa). Kierownictwo nie edytuje i nie usuwa wpisów.

Role nadaje się w ustawieniach Netlify Identity (Users → użytkownik → Roles).

## Status wpisu

Każdy wpis jest fabrycznie **aktywny**. Admin może ręcznie zmienić go na **zawieszony** lub **nieaktywny** (okno edycji). Taki wpis jest pokazywany w wyszukiwarce z odpowiednią etykietą, nie ma zaświadczenia, a kod QR na plakietce pokazuje „NIE”.

## Plakietki i kod QR

Przy każdej osobie w panelu jest ikona plakietki (`/plakietka/<id>`, dostępna tylko po zalogowaniu jako `kierownictwo` lub `admin`). Plakietka (85,6 × 54 mm, do wydruku) zawiera imię i nazwisko, tytuł zawodowy (lekarz, pielęgniarz albo ratownik medyczny), PESEL i numer seryjny, którym jest numer PWZ. Zamiast zdjęcia jest kod QR prowadzący do publicznej strony `/weryfikacja/<PWZ>`, która pokazuje tylko duże **TAK** albo **NIE** (czy wpis jest prawdziwy i aktualny) oraz – przy „TAK” – imię, nazwisko i zawód. Kod QR jest generowany w przeglądarce własnym kodem (`src/lib/qr.ts`), bez zewnętrznych usług.

## Bezpieczeństwo

- Logowanie dwuetapowe: po haśle przychodzi e-mail z kodem (ważny 10 minut). Włącza się samo, gdy w Netlify ustawisz zmienną `RESEND_API_KEY` (konto na resend.com); opcjonalnie `EMAIL_FROM` (nadawca). Bez klucza kod nie jest wymagany, żeby nikogo nie zablokować.
- **Ochrona przed zgadywaniem:** po 8 nieudanych logowaniach z jednego adresu IP formularz logowania blokuje ten adres na 15 minut (blokada działa w formularzu panelu; hasła sprawdza Netlify Identity, które ma własne limity). Kod z e-maila: 5 błędnych prób unieważnia kod, a po 3 takich seriach konto nie dostaje nowego kodu przez 15 minut. Wyszukiwanie po numerach (PESEL/PWZ) i weryfikacje QR mają limit 15 zapytań na minutę z jednego adresu.
- **PESEL jest ukryty w tabeli:** lista nie zawiera numerów PESEL. Odsłonięcie jednego (oko w tabeli, edycja wpisu, plakietka) jest zapisywane w dzienniku zdarzeń; po 30 sekundach numer znów się ukrywa. Wyszukiwanie po PESEL działa po stronie serwera.
- **Alerty bezpieczeństwa** (przycisk „Alerty” dla adminów, z licznikiem): wiele nieudanych logowań z jednego adresu lub na jedno konto, zgadywanie kodu z e-maila, przekroczenie limitu zapytań o numery, masowe odsłanianie PESEL (15 w 10 minut) i logowanie z nowego adresu IP. Przy ustawionym `RESEND_API_KEY` alerty są też wysyłane e-mailem do adminów.
- **Urządzenia:** przycisk „Urządzenia” pokazuje przeglądarki zalogowane na koncie (z adresem IP), pozwala wylogować każdą z nich albo wszystkie naraz. Wylogowane urządzenie od razu traci dostęp do panelu.
- Każda zmiana trafia do dziennika zdarzeń (tylko admin).

## Powiadomienia

Panel adminów sprawdza co minutę, czy są nowe wnioski, zgłoszenia albo alerty (liczniki na przyciskach i komunikat). Przy ustawionym `RESEND_API_KEY` admini dostają też e-mail o nowym wniosku, zgłoszeniu i alercie, a kierownictwo o decyzji w sprawie wniosku.

## Strony publiczne

- `/jak-to-dziala` – krótka instrukcja i FAQ.
- `/zglos-blad` – formularz zgłaszania błędów w rejestrze (limit 3 zgłoszeń na godzinę z jednego adresu); zgłoszenia czytają admini w panelu („Zgłoszenia”).
- Strona główna pokazuje liczbę aktywnych lekarzy, pielęgniarzy i ratowników medycznych.
- Przełącznik trybu jasnego i ciemnego jest w nagłówku (wybór zapamiętuje przeglądarka).

Tabela „Osoby w rejestrze” ma wyszukiwarkę pracowników (imię, nazwisko, PESEL, PWZ, zawód, specjalizacja), filtry, sortowanie i działa dla obu ról; ignoruje wielkość liter i polskie znaki, a słowa można wpisać w dowolnej kolejności.
