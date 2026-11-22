import { Link, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/dla-pracodawcow')({
  head: () => ({
    meta: [{ title: 'Dla pracodawców – Centralny Rejestr' }],
  }),
  component: ForEmployers,
})

const STATUSES: { name: string; meaning: string }[] = [
  { name: 'Aktywny', meaning: 'Osoba ma ważny wpis. Może wykonywać zawód.' },
  {
    name: 'Zawieszony',
    meaning: 'Prawo wykonywania zawodu jest chwilowo zawieszone. Nie przyjmuj tej osoby do pracy w zawodzie, dopóki status się nie zmieni.',
  },
  {
    name: 'Nieaktywny',
    meaning: 'Wpis wygasł (minął termin ważności PWZ) albo został wyłączony. Poproś osobę o odnowienie.',
  },
  { name: 'Nie znaleziono', meaning: 'Nie ma wpisu o takich danych. Sprawdź, czy dane zostały wpisane poprawnie.' },
]

function ForEmployers() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-[var(--registry-navy)] sm:text-4xl">
        Dla pracodawców
      </h1>
      <p className="mt-3 text-muted-foreground">
        Jak w kilka sekund sprawdzić, czy kandydat lub pracownik ma ważny wpis w rejestrze.
      </p>

      <ol className="mt-8 space-y-4">
        <li className="rounded-lg border bg-white p-5 shadow-sm">
          <h2 className="font-semibold">1. Poproś o numer PWZ lub plakietkę</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Najszybciej: poproś o zeskanowanie kodu QR z plakietki. Kod prowadzi na stronę
            weryfikacji z dużym TAK lub NIE. Możesz też wpisać numer PWZ na{' '}
            <Link to="/" className="underline">stronie głównej</Link>.
          </p>
        </li>
        <li className="rounded-lg border bg-white p-5 shadow-sm">
          <h2 className="font-semibold">2. Sprawdź imię, nazwisko i zawód</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Porównaj dane z wyniku z dokumentem tożsamości. Sam numer PWZ nie wystarczy: ktoś mógł
            podać cudzy numer.
          </p>
        </li>
        <li className="rounded-lg border bg-white p-5 shadow-sm">
          <h2 className="font-semibold">3. Zwróć uwagę na ważność</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Strona weryfikacji pokazuje termin ważności PWZ: „dożywotnio” albo datę końcową. Po tej
            dacie wpis staje się nieaktywny.
          </p>
        </li>
      </ol>

      <h2 className="mt-10 font-[family-name:var(--font-heading)] text-2xl font-bold text-[var(--registry-navy)]">
        Co oznaczają statusy
      </h2>
      <dl className="mt-4 space-y-2">
        {STATUSES.map((status) => (
          <div key={status.name} className="rounded-lg border bg-white px-5 py-3 shadow-sm">
            <dt className="font-semibold">{status.name}</dt>
            <dd className="mt-1 text-sm text-muted-foreground">{status.meaning}</dd>
          </div>
        ))}
      </dl>

      <h2 className="mt-10 font-[family-name:var(--font-heading)] text-2xl font-bold text-[var(--registry-navy)]">
        Coś wygląda podejrzanie?
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Jeśli dane się nie zgadzają albo plakietka budzi wątpliwości, nie przyjmuj osoby do pracy
        w zawodzie i{' '}
        <Link to="/zglos-blad" className="underline">zgłoś sprawę przez formularz kontaktowy</Link>.
      </p>
      <p className="mt-6 text-xs text-muted-foreground">
        To strona fikcyjna, stworzona na potrzeby roleplayu: wpisy nie mają mocy prawnej.
        Zobacz też{' '}
        <Link to="/regulamin" className="underline">regulamin</Link> oraz{' '}
        <Link to="/prywatnosc" className="underline">politykę prywatności</Link>.
      </p>
    </div>
  )
}
