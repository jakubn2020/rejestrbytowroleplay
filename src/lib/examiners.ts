/** Client-safe definitions for the examiner roles: the limits the owner can set and their defaults. */

export type ExaminerLimits = {
  /** Examiner: how many entry requests fit in the window. */
  requestsCount: number
  requestsWindowMinutes: number
  /** Examiner: requests waiting for a decision at the same time. */
  pendingMax: number
  /** Moderator: examiner accounts that may exist at once. */
  maxExaminers: number
  /** Moderator: accounts one moderator may add in 24 hours. */
  addPerDay: number
  /** Moderator: removal requests in 24 hours. */
  removalPerDay: number
  /** Moderator: the longest suspension in hours. */
  suspendMaxHours: number
}

export const EXAMINER_LIMIT_DEFAULTS: ExaminerLimits = {
  requestsCount: 2,
  requestsWindowMinutes: 20,
  pendingMax: 10,
  maxExaminers: 50,
  addPerDay: 10,
  removalPerDay: 5,
  suspendMaxHours: 168,
}

export const EXAMINER_LIMIT_FIELDS: {
  key: keyof ExaminerLimits
  label: string
  hint: string
  min: number
  max: number
}[] = [
  { key: 'requestsCount', label: 'Wnioski egzaminatora: ile w oknie czasu', hint: 'Ile wniosków o wpis może złożyć egzaminator w jednym oknie.', min: 1, max: 50 },
  { key: 'requestsWindowMinutes', label: 'Wnioski egzaminatora: okno czasu (minuty)', hint: 'Długość okna, np. 20 minut.', min: 1, max: 1440 },
  { key: 'pendingMax', label: 'Wnioski egzaminatora: oczekujące naraz', hint: 'Po przekroczeniu trzeba poczekać na decyzje administratora.', min: 1, max: 200 },
  { key: 'maxExaminers', label: 'Moderator: łączna liczba kont egzaminatorów', hint: 'Górna granica liczby kont egzaminatorów.', min: 1, max: 1000 },
  { key: 'addPerDay', label: 'Moderator: nowe konta na dobę', hint: 'Ile kont egzaminatorów może dodać jeden moderator w ciągu 24 godzin.', min: 1, max: 200 },
  { key: 'removalPerDay', label: 'Moderator: wnioski o usunięcie na dobę', hint: 'Ile wniosków o usunięcie konta może złożyć jeden moderator w ciągu 24 godzin.', min: 1, max: 200 },
  { key: 'suspendMaxHours', label: 'Moderator: najdłuższe zawieszenie (godziny)', hint: 'Dłuższe zawieszenie lub usunięcie konta wymaga administratora.', min: 1, max: 720 },
]

/** Settings keys: `exlim_<name>`. */
export const examinerLimitKey = (key: keyof ExaminerLimits) => `exlim_${key}`

export type ExaminerRequestStats = { total: number; approved: number; rejected: number; pending: number }

export const EXAMINER_TIPS: string[] = [
  'Zrzut ekranu musi pokazywać wiadomość, w której sama osoba prosi o wpis. Czytelny zrzut skraca czas decyzji.',
  'Sprawdź PESEL przed wysłaniem. Wniosek z błędnym numerem zostanie odrzucony, a limit i tak się zużyje.',
  'Szkic formularza zapisuje się w tej przeglądarce. Jeśli odświeżysz stronę, imię, nazwisko i PESEL zostaną.',
  'Gdy limit jest wyczerpany, przygotuj kolejny wniosek w formularzu. Odblokuje się sam po odliczeniu.',
  'Odrzucony wniosek ma uwagę administratora. Przeczytaj ją, zanim złożysz poprawiony.',
  'Nie udostępniaj hasła nikomu. Moderator nie zna Twojego hasła i nigdy o nie nie poprosi.',
]
