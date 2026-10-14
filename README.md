# Centralny Rejestr Lekarzy, Pielęgniarzy i Ratowników Medycznych

Fikcyjny rejestr zawodów medycznych na potrzeby roleplayu. Każdy może wyszukać osobę po numerze PESEL, numerze PWZ albo pełnym imieniu i nazwisku. Wynik pokazuje wyłącznie imię i nazwisko, numer PWZ, zawód i specjalizację (dla ratowników medycznych zawsze „nd.”). PESEL nigdy nie jest pokazywany publicznie.

Administrator loguje się na stronie `/admin` i dodaje lub usuwa osoby. Numer PWZ wyliczany jest automatycznie: ostatnie 7 cyfr PESEL-u (PESEL może mieć dowolną liczbę cyfr; krótszy niż 7 cyfr jest dopełniany zerami z lewej), a jeśli wynik zaczyna się od 0, pierwsza cyfra zamieniana jest na 1.

Dostępne zawody: lekarz rezydent, lekarz, lekarz specjalista, ratownik medyczny (magister / licencjat), pielęgniarz (magister / licencjat).

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
