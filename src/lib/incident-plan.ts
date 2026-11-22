/** Shared by the security centre (client) and the incident functions (server). */
export const INCIDENT_PLAN: string[] = [
  'Zachowaj spokój i nie usuwaj niczego. Dowody zostały już zamrożone w momencie otwarcia incydentu.',
  'Ustal, co się stało: zajrzyj do alertów i ostatnich zdarzeń w Centrum bezpieczeństwa.',
  'Jeśli podejrzewasz przejęcie konta: zablokuj je i wygeneruj jednorazowy link resetu hasła.',
  'Jeśli atak trwa: zamknij rejestr i wyloguj wszystkich albo włącz tryb blokady (lockdown).',
  'Zablokuj podejrzane adresy IP (lista adresów) i sprawdź ranking ruchu.',
  'Sprawdź w dzienniku, kto i co zmieniał, oraz kto odsłaniał numery PESEL.',
  'Zrób kopię zapasową rejestru, a w razie uszkodzeń przywróć dane z wcześniejszej kopii.',
  'Wymuś zmianę haseł (unieważnij hasła) i poinformuj administratorów.',
  'Zapisuj każdy krok w notatniku incydentu: czas i opis tworzą oś czasu raportu.',
]

export const INCIDENT_CHECKLIST: { id: string; label: string }[] = [
  { id: 'cause', label: 'Ustalono przyczynę incydentu' },
  { id: 'accounts', label: 'Sprawdzono i zabezpieczono konta (blokady, hasła)' },
  { id: 'ips', label: 'Zablokowano podejrzane adresy IP' },
  { id: 'data', label: 'Sprawdzono, czy dane w rejestrze są poprawne' },
  { id: 'restore', label: 'Przywrócono dane z kopii (jeśli były uszkodzone)' },
  { id: 'passwords', label: 'Zmieniono hasła, wylogowano użytkowników' },
  { id: 'inform', label: 'Poinformowano administratorów i kierownictwo' },
  { id: 'reopen', label: 'Otwarto rejestr i wyłączono lockdown' },
  { id: 'monitor', label: 'Ustawiono dodatkowe monitorowanie na kilka dni' },
]
