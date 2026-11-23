# Centralny Rejestr Lekarzy, Pielęgniarzy i Ratowników Medycznych

Fikcyjny rejestr zawodów medycznych na potrzeby roleplayu. Każdy może wyszukać osobę po numerze PESEL, numerze PWZ albo pełnym imieniu i nazwisku. Wynik pokazuje wyłącznie imię i nazwisko, numer PWZ, zawód i specjalizację (dla ratowników medycznych zawsze „nd.”). PESEL nigdy nie jest pokazywany publicznie.

Administrator loguje się na stronie `/admin` i dodaje lub usuwa osoby. Numer PWZ wyliczany jest automatycznie: ostatnie 7 cyfr PESEL-u (PESEL może mieć dowolną liczbę cyfr; krótszy niż 7 cyfr jest dopełniany zerami z lewej), a jeśli wynik zaczyna się od 0, pierwsza cyfra zamieniana jest na 1.

Dostępne zawody: lekarz rezydent, lekarz, lekarz specjalista, ratownik medyczny, pielęgniarz.

## Technologie

- TanStack Start (React 19), Tailwind CSS 4, shadcn/ui
- Cloudflare Workers — hosting (`wrangler.jsonc`)
- Postgres (Neon) + Drizzle ORM — przechowywanie wpisów i kont
- Własne logowanie (tabele `users`, `auth_sessions`, hasła PBKDF2) — role `admin` i `kierownictwo`

## Wdrożenie na Cloudflare

1. **Baza.** Potrzebujesz Postgresa dostępnego z internetu (np. darmowy Neon). Zostaw dotychczasową bazę albo zrób nową i przenieś dane:
   `pg_dump "STARY_URL" --data-only --no-owner > dane.sql` oraz `psql "NOWY_URL" < dane.sql`.
2. **Tabele.** W nowej, pustej bazie wykonaj po kolei pliki `netlify/database/migrations/*/migration.sql` (kolejność alfabetyczna folderów). W bazie, która już działa, wystarczy najnowszy folder `20261120075859_auth_accounts` (nowe tabele kont).
3. **Sekrety** (w katalogu projektu, po `pnpm install` i `pnpm wrangler login`):
   - `pnpm wrangler secret put DATABASE_URL` — adres połączenia do bazy,
   - `pnpm wrangler secret put SUPERADMIN_EMAIL` — e-mail właściciela (konto, które dodaje administratorów),
   - `pnpm wrangler secret put SITE_URL` — adres strony, np. `https://twojadomena.pl` (do linków w e-mailach),
   - opcjonalnie `RESEND_API_KEY` i `EMAIL_FROM` — kody 2FA i powiadomienia e-mail (bez klucza kod nie jest wymagany).
4. **Konto właściciela:** `DATABASE_URL="..." pnpm create-user wlasciciel@example.com "silne-haslo" admin` (ten sam e-mail co w `SUPERADMIN_EMAIL`).
5. **Wdrożenie:** `pnpm deploy`. Domenę dodajesz w panelu Cloudflare: Workers & Pages → projekt → Settings → Domains & Routes → Add → Custom domain.
6. **Konta z Netlify Identity:** hasła nie przenoszą się. Właściciel dodaje administratorów w panelu („Dodaj administratora”), a administratorzy dodają kierownictwo („Dodaj kierownictwo”). Każdy dostaje hasło początkowe i może je zmienić przyciskiem „Zmień hasło”.

## Uruchomienie lokalne

```bash
pnpm install
# plik .dev.vars w katalogu projektu (nie trafia do gita):
#   DATABASE_URL=postgres://...
#   SUPERADMIN_EMAIL=ty@example.com
pnpm dev
```

Po zmianie `db/schema.ts` wygeneruj migrację: `DATABASE_URL=... npx drizzle-kit generate --name <nazwa>` i wykonaj jej `migration.sql` w bazie.

## Role

- `admin` – dodaje osoby bezpośrednio, usuwa je (do kosza na 30 dni), edytuje PESEL, specjalizację, status i ręcznie ustawia numer PWZ (PWZ musi mieć 7 cyfr i być unikalny). Tylko `admin` widzi przyciski: „Dodaj kierownictwo”, „Konta kierownictwa” (lista, reset hasła, usuwanie), „Wnioski” (akceptacja lub odrzucenie wniosków kierownictwa o wpis i o zmianę terminu PWZ), „Statystyki” (anonimowe odwiedziny całej strony), „Kosz” i „Dziennik zdarzeń” (z filtrami i eksportem CSV).
- `kierownictwo` – widzi numery PESEL, wyszukuje pracowników i tworzy plakietki. Nie dodaje osób bezpośrednio: składa **wniosek** (imię, nazwisko, PESEL, zawód i **zrzut ekranu wiadomości**, w której ta osoba prosi o wpis), najwyżej jeden na 5 minut (limit liczony po stronie serwera). Wniosek akceptuje lub odrzuca admin, oglądając zrzut ekranu; po akceptacji wpis powstaje automatycznie (w rejestrze figuruje jako dodany przez osobę z kierownictwa). Kierownictwo nie edytuje i nie usuwa wpisów.

Role nadaje się przy zakładaniu konta: kierownictwo dodaje każdy administrator, a administratorów dodaje tylko właściciel (konto z `SUPERADMIN_EMAIL`), w sekcji „Dodaj administratora” i „Konta administratorów”. Konta właściciela nie da się usunąć z panelu.

## Ważność PWZ

Domyślnie PWZ jest **dożywotni**. Admin może przy dodawaniu albo edycji ustawić, że wygasa za 3 miesiące albo za własną liczbę dni lub miesięcy (liczone od dziś). Po upływie terminu wpis sam staje się „Nieaktywny”: wyszukiwarka pokazuje to w statusie, kod QR na plakietce pokazuje „NIE”, a wpis przestaje liczyć się w statystykach. Termin można w każdej chwili zmienić (np. na „Dożywotnio”). Zmiany są w dzienniku zdarzeń.

## Status wpisu

Każdy wpis jest fabrycznie **aktywny**. Admin może ręcznie zmienić go na **zawieszony** lub **nieaktywny** (okno edycji). Taki wpis jest pokazywany w wyszukiwarce z odpowiednią etykietą, nie ma zaświadczenia, a kod QR na plakietce pokazuje „NIE”.

## Plakietki i kod QR

Przy każdej osobie w panelu jest ikona plakietki (`/plakietka/<id>`, dostępna tylko po zalogowaniu jako `kierownictwo` lub `admin`). Plakietka (85,6 × 54 mm, do wydruku) zawiera imię i nazwisko, tytuł zawodowy (lekarz, pielęgniarz albo ratownik medyczny), PESEL i numer seryjny, którym jest numer PWZ. Zamiast zdjęcia jest kod QR prowadzący do publicznej strony `/weryfikacja/<PWZ>`, która pokazuje tylko duże **TAK** albo **NIE** (czy wpis jest prawdziwy i aktualny) oraz – przy „TAK” – imię, nazwisko i zawód. Kod QR jest generowany w przeglądarce własnym kodem (`src/lib/qr.ts`), bez zewnętrznych usług.

## Bezpieczeństwo

- Logowanie dwuetapowe: po haśle przychodzi e-mail z kodem (ważny 10 minut). Włącza się samo, gdy ustawisz sekret `RESEND_API_KEY` (konto na resend.com); opcjonalnie `EMAIL_FROM` (nadawca). Bez klucza kod nie jest wymagany, żeby nikogo nie zablokować.
- **Ochrona przed zgadywaniem:** po 8 nieudanych logowaniach z jednego adresu IP formularz logowania blokuje ten adres na 15 minut (blokada działa w formularzu panelu; limit liczony jest po stronie serwera, przy każdej próbie logowania). Kod z e-maila: 5 błędnych prób unieważnia kod, a po 3 takich seriach konto nie dostaje nowego kodu przez 15 minut. Wyszukiwanie po numerach (PESEL/PWZ) i weryfikacje QR mają limit 15 zapytań na minutę z jednego adresu.
- **PESEL jest ukryty w tabeli:** lista nie zawiera numerów PESEL. Odsłonięcie jednego (oko w tabeli, edycja wpisu, plakietka) jest zapisywane w dzienniku zdarzeń; po 30 sekundach numer znów się ukrywa. Wyszukiwanie po PESEL działa po stronie serwera.
- **Alerty bezpieczeństwa** (przycisk „Alerty” dla adminów, z licznikiem): wiele nieudanych logowań z jednego adresu lub na jedno konto, zgadywanie kodu z e-maila, przekroczenie limitu zapytań o numery, masowe odsłanianie PESEL (15 w 10 minut) i logowanie z nowego adresu IP. Przy ustawionym `RESEND_API_KEY` alerty są też wysyłane e-mailem do adminów.
- **Urządzenia:** przycisk „Urządzenia” pokazuje przeglądarki zalogowane na koncie (z adresem IP), pozwala wylogować każdą z nich albo wszystkie naraz. Wylogowane urządzenie od razu traci dostęp do panelu.
- Każda zmiana trafia do dziennika zdarzeń (tylko admin).

## Powiadomienia

Panel adminów sprawdza co minutę, czy są nowe wnioski, zgłoszenia albo alerty (czerwone kółko z liczbą na przyciskach oraz w nagłówku strony, i komunikat). Przy ustawionym `RESEND_API_KEY` admini dostają też e-mail o nowym wniosku, zgłoszeniu i alercie, a kierownictwo o decyzji w sprawie wniosku.

## Strony publiczne

- `/jak-to-dziala` – krótka instrukcja i FAQ.
- `/zglos-blad` – formularz zgłaszania błędów w rejestrze (limit 3 zgłoszeń na godzinę z jednego adresu); zgłoszenia czytają admini w panelu („Zgłoszenia”).
- Strona główna pokazuje liczbę aktywnych lekarzy, pielęgniarzy i ratowników medycznych.
- Przełącznik trybu jasnego i ciemnego jest w nagłówku (wybór zapamiętuje przeglądarka).

Tabela „Osoby w rejestrze” ma wyszukiwarkę pracowników (imię, nazwisko, PESEL, PWZ, zawód, specjalizacja), filtry, sortowanie i działa dla obu ról; ignoruje wielkość liter i polskie znaki, a słowa można wpisać w dowolnej kolejności.


## Wnioski o zmianę terminu i statystyki

- Kierownictwo składa wniosek o zmianę ważności PWZ (dożywotnio / 3 miesiące / własna liczba dni lub miesięcy) przyciskiem z ikoną kalendarza w tabeli; wymagany zrzut ekranu, wspólny limit 1 wniosku na 5 minut. Nowy termin liczy się od dnia akceptacji przez admina.
- Statystyki odwiedzin (tabele `visit_stats`, `visit_uniques`) są anonimowe: liczniki dzienne i dzienny skrót z solą, bez adresów IP; nie liczą `/admin`, `/plakietka` ani botów.
- Migracja: `netlify/database/migrations/20261120160000_expiry_requests_visits/migration.sql` (uruchom ręcznie w Neon SQL Editor).

## Aktualizacja 2.7

- **Tryb awaryjny** (przycisk w panelu admina): zamyka wyszukiwarkę i weryfikację QR z komunikatem, w nagłówku pokazuje się czerwony pasek.
- Osoba z kosza może zostać dodana ponownie bez opróżniania kosza.
- **Dziennik zmian** pod `/zmiany`, edytowany w `src/lib/changelog.ts`.
- Własne motywy kolorystyczne (ikona palety w nagłówku).
- Statystyki: ranking najaktywniejszego kierownictwa.
- Alert dla adminów i e-mail do właściciela konta przy logowaniu z nowego urządzenia; masowe odsłanianie PESEL (15 w 10 minut) wywołuje alert od wersji wcześniejszej. Nie ma nowej migracji.

## Aktualizacja 3.0: Centrum bezpieczeństwa

Migracja **przed wdrożeniem**: `netlify/database/migrations/20261121200000_security_center/migration.sql` (dodaje kolumny do `users`, `security_events`, `audit_log` oraz tabele `ip_rules`, `password_resets`, `traffic`, `incidents`, `incident_notes`, `backups`). Skrypt jest idempotentny (`IF NOT EXISTS`). Bez niej logowanie przestanie działać, bo kod czyta nowe kolumny.

- Kraj logowania pochodzi z nagłówka Cloudflare `cf-ipcountry` (`T1` = Tor).
- Zmiany polityki (progi, limity) zapisują się w tabeli `settings` (klucze `sec_*`).
- Nie ma CAPTCHA (wymagałaby kluczy Cloudflare Turnstile).

## Moduł egzaminów (beta, tylko właściciel)

Strona `/egzaminy` (przycisk „Egzaminy (beta)” w panelu właściciela). Wykładowca opisuje zagadnienia i/lub dołącza PDF, a AI (Gemini) generuje wybraną liczbę wersji egzaminu (A–E, domyślnie trzy): pytania zamknięte A–E, prawda/fałsz i otwarte. Wersje można ręcznie edytować. „Rozpocznij test” tworzy jednorazowy link `/egzamin/<token>` i listę loginów (wpisanych ręcznie albo wygenerowanych, np. BA1, CH7). Uczniowie wpisują login (jeden login = jedno urządzenie), czekają w poczekalni, a prowadzący startuje test dla wszystkich naraz. Każdy uczeń ma własną kolejność pytań i odpowiedzi oraz znak wodny z loginem. Strona egzaminu zgłasza opuszczenie okna, bezczynność (60 s), kopiowanie/wklejanie, menu kontekstowe, zmianę rozmiaru okna i brak sieci. Zamknięte są oceniane automatycznie, otwarte oznacza egzaminator jako zaliczone/niezaliczone.

- Wymaga sekretu `pnpm wrangler secret put GEMINI_API_KEY` (opcjonalnie `GEMINI_MODEL`, domyślnie `gemini-3.8-flash`).
- Groq: sekret `GROQ_API_KEY` (opcjonalnie `GROQ_MODEL`, domyślnie `llama-3.3-70b-versatile`). Gdy klucz jest ustawiony, Groq jest pierwszy, a Gemini zapasowy (`AI_PROVIDER=gemini` odwraca kolejność). Tekst z załączonego PDF jest wyciągany na serwerze (biblioteka `unpdf`, do 20 000 znaków), więc działa z każdym dostawcą; skan bez warstwy tekstu nie zadziała.
- Wymaga migracji `20261123100000_exams` (uruchom `migration.sql` w Neon przed wdrożeniem).
- Dostęp obecnie: tylko właściciel (`requireSuperAdmin` zaimportowane jako `requireExamStaff` w `src/lib/exams.functions.ts`; tu docelowo role wykładowcy i egzaminatora).
