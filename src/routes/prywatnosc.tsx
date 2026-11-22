import { Link, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/prywatnosc')({
  head: () => ({ meta: [{ title: 'Polityka prywatności – Centralny Rejestr' }] }),
  component: Privacy,
})

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: '1. Dane fikcyjne',
    body: [
      'Rejestr jest fikcyjny i służy wyłącznie do gry fabularnej. Nie należy wpisywać do niego prawdziwych danych osobowych, w tym prawdziwych numerów PESEL. Jeśli mimo to ktoś to zrobił, może poprosić o usunięcie wpisu przez formularz zgłoszeń.',
    ],
  },
  {
    title: '2. Jakie dane przechowujemy',
    body: [
      'Rejestr: imię, nazwisko, zawód, specjalizacja, numer PESEL, numer PWZ, status i termin ważności wpisu. Numer PESEL nie jest pokazywany publicznie; w panelu jest maskowany albo widoczny tylko dla administratorów, a odsłonięcia są zapisywane.',
      'Konta personelu: adres e-mail, zaszyfrowane hasło, role, data ostatniego logowania.',
      'Dziennik i zabezpieczenia: kto i kiedy zmienił wpis, zdarzenia logowania oraz alerty. Zapisujemy adres IP, kraj (z danych Cloudflare) i opis przeglądarki, żeby wykrywać nadużycia i przejęcia kont. Zdarzenia bezpieczeństwa przechowujemy do 90 dni.',
      'Ruch w wyszukiwarce: adres IP i liczba zapytań na minutę, przechowywane do 48 godzin (wykrywanie nadużyć i limity).',
    ],
  },
  {
    title: '3. Statystyki odwiedzin',
    body: [
      'Liczymy odsłony stron i unikalnych odwiedzających dziennie. Są to anonimowe liczniki: nie zapisujemy adresów IP w statystykach, a odwiedzający jest rozpoznawany tylko przez dzienny skrót, którego nie da się odwrócić.',
    ],
  },
  {
    title: '4. Pliki cookie i pamięć przeglądarki',
    body: [
      'Personel logujący się do panelu otrzymuje cookie sesji (niezbędne do działania). Odwiedzający nie dostają cookies reklamowych ani śledzących.',
      'W pamięci przeglądarki (localStorage) zapisujemy wyłącznie ustawienia wyglądu: motyw jasny/ciemny, kolor, szerokość tabeli i informację o przeczytanych nowościach. Zostają one na Twoim urządzeniu.',
    ],
  },
  {
    title: '5. Gdzie dane są przetwarzane',
    body: [
      'Strona działa na Cloudflare Workers, a dane są w bazie Neon (Postgres). E-maile z powiadomieniami, jeśli są włączone, wysyła usługa Resend.',
    ],
  },
  {
    title: '6. Twoje prawa',
    body: [
      'Możesz poprosić o sprostowanie lub usunięcie wpisu, wysyłając zgłoszenie przez formularz „Zgłoś błąd”. Wpisy usunięte trafiają najpierw do kosza (na ograniczony czas), a potem są usuwane na stałe.',
    ],
  },
]

function Privacy() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-[var(--registry-navy)] sm:text-4xl">
        Polityka prywatności
      </h1>
      <p className="mt-3 text-muted-foreground">Jakie dane zbiera ta strona i po co.</p>
      <div className="mt-8 space-y-4">
        {SECTIONS.map((section) => (
          <section key={section.title} className="rounded-lg border bg-white p-5 shadow-sm">
            <h2 className="font-semibold">{section.title}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph} className="mt-2 text-sm text-muted-foreground">{paragraph}</p>
            ))}
          </section>
        ))}
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        Zobacz też <Link to="/regulamin" className="underline">regulamin</Link>.
      </p>
    </div>
  )
}
