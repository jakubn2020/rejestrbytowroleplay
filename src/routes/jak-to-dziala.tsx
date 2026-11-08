import { Link, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/jak-to-dziala')({
  head: () => ({
    meta: [{ title: 'Jak to działa – Centralny Rejestr' }],
  }),
  component: HowItWorks,
})

const FAQ: { question: string; answer: string }[] = [
  {
    question: 'Czy to prawdziwy rejestr?',
    answer:
      'Nie. To strona fikcyjna, stworzona wyłącznie na potrzeby roleplayu. Dane nie dotyczą prawdziwych osób, a wpisy i plakietki nie mają żadnej mocy prawnej.',
  },
  {
    question: 'Jak sprawdzić, czy ktoś jest w rejestrze?',
    answer:
      'Na stronie głównej wpisz numer PESEL, numer PWZ (7 cyfr) albo pełne imię i nazwisko. Wynik pokazuje imię i nazwisko, numer PWZ, zawód, specjalizację i status wpisu.',
  },
  {
    question: 'Skąd się bierze numer PWZ?',
    answer:
      'To ostatnie 7 cyfr numeru PESEL. Jeśli PESEL jest krótszy niż 7 cyfr, jest dopełniany zerami z lewej strony, a gdy wynik zaczyna się od 0, pierwsza cyfra zamieniana jest na 1.',
  },
  {
    question: 'Dlaczego nie widzę numeru PESEL?',
    answer:
      'PESEL nigdy nie jest pokazywany publicznie. Widzą go tylko osoby z kierownictwa i administratorzy, a każde odsłonięcie numeru jest zapisywane w dzienniku zdarzeń.',
  },
  {
    question: 'Co znaczą statusy wpisu?',
    answer:
      'Aktywny – osoba ma prawo wykonywania zawodu. Zawieszony – prawo jest czasowo wstrzymane. Nieaktywny – wpis nie jest już aktualny. Status zmieniają wyłącznie administratorzy.',
  },
  {
    question: 'Co oznacza TAK lub NIE po zeskanowaniu kodu QR z plakietki?',
    answer:
      'Kod QR prowadzi do strony weryfikacji. TAK oznacza, że wpis istnieje i jest aktywny, czyli plakietka jest prawdziwa i aktualna. NIE oznacza, że wpisu nie ma albo jest zawieszony lub nieaktywny.',
  },
  {
    question: 'Jak zostać wpisanym do rejestru?',
    answer:
      'Wpisy dodaje administrator. Kierownictwo składa w tym celu wniosek razem ze zrzutem ekranu wiadomości, w której dana osoba prosi o wpis, a administrator go akceptuje lub odrzuca.',
  },
  {
    question: 'Widzę komunikat o zbyt wielu zapytaniach. Co zrobić?',
    answer:
      'Wyszukiwanie po numerach ma limit zapytań z jednego adresu, żeby nikt nie zgadywał numerów. Odczekaj minutę i spróbuj jeszcze raz.',
  },
  {
    question: 'Znalazłem błąd w rejestrze. Gdzie to zgłosić?',
    answer:
      'Skorzystaj z formularza zgłaszania błędów. Zgłoszenia czytają administratorzy.',
  },
]

function HowItWorks() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-[var(--registry-navy)] sm:text-4xl">
        Jak to działa
      </h1>
      <p className="mt-3 text-muted-foreground">
        Centralny Rejestr to fikcyjna baza lekarzy, pielęgniarzy i ratowników
        medycznych. Poniżej najważniejsze zasady i odpowiedzi na częste pytania.
      </p>

      <ol className="mt-8 space-y-4">
        <li className="rounded-lg border bg-white p-5 shadow-sm">
          <h2 className="font-semibold">1. Wyszukaj osobę</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Podaj PESEL, numer PWZ albo imię i nazwisko na{' '}
            <Link to="/" className="underline">
              stronie głównej
            </Link>
            .
          </p>
        </li>
        <li className="rounded-lg border bg-white p-5 shadow-sm">
          <h2 className="font-semibold">2. Sprawdź status wpisu</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Wpis jest aktywny, zawieszony albo nieaktywny. Tylko aktywny wpis
            oznacza, że osoba ma prawo wykonywania zawodu.
          </p>
        </li>
        <li className="rounded-lg border bg-white p-5 shadow-sm">
          <h2 className="font-semibold">3. Zeskanuj kod z plakietki</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Plakietka ma kod QR. Po jego zeskanowaniu zobaczysz duże TAK lub NIE:
            czy wpis jest prawdziwy i aktualny.
          </p>
        </li>
      </ol>

      <h2 className="mt-12 font-[family-name:var(--font-heading)] text-2xl font-bold text-[var(--registry-navy)]">
        Najczęstsze pytania
      </h2>
      <div className="mt-4 space-y-2">
        {FAQ.map((item) => (
          <details
            key={item.question}
            className="group rounded-lg border bg-white px-5 py-3 shadow-sm"
          >
            <summary className="cursor-pointer font-semibold marker:text-muted-foreground">
              {item.question}
            </summary>
            <p className="mt-2 text-sm text-muted-foreground">{item.answer}</p>
          </details>
        ))}
      </div>

      <p className="mt-8 text-sm text-muted-foreground">
        Nie znalazłeś odpowiedzi albo zauważyłeś błąd?{' '}
        <Link to="/zglos-blad" className="underline">
          Zgłoś błąd w rejestrze
        </Link>
        .
      </p>
    </div>
  )
}
