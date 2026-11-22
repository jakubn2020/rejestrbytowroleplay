import { Link, createFileRoute } from '@tanstack/react-router'

import { LegalVersionInfo } from '@/components/legal-version-info'
import { TERMS_VERSIONS } from '@/lib/legal'

export const Route = createFileRoute('/regulamin')({
  head: () => ({ meta: [{ title: 'Regulamin – Centralny Rejestr' }] }),
  component: Terms,
})

const SECTIONS: { title: string; body: string[] }[] = [
  {
    title: '1. Charakter strony',
    body: [
      'Centralny Rejestr Lekarzy, Pielęgniarzy i Ratowników Medycznych to strona fikcyjna, stworzona wyłącznie na potrzeby gry fabularnej (roleplayu). Nie jest rejestrem prawdziwej instytucji, a wpisy, numery PWZ i plakietki nie mają żadnej mocy prawnej ani urzędowej.',
      'Nie należy używać wpisów ani plakietek poza grą, w szczególności do wprowadzania kogokolwiek w błąd co do uprawnień do wykonywania zawodu.',
    ],
  },
  {
    title: '2. Korzystanie z wyszukiwarki',
    body: [
      'Wyszukiwarka i strona weryfikacji są dostępne dla każdego. Zapytania są ograniczane limitem, a nadmierne albo zautomatyzowane zgadywanie numerów może skończyć się czasową blokadą adresu.',
      'Zabronione jest masowe pobieranie danych z rejestru, omijanie limitów i zabezpieczeń oraz podszywanie się pod inne osoby.',
    ],
  },
  {
    title: '3. Konta administratorów i kierownictwa',
    body: [
      'Konta personelu są nadawane przez właściciela strony. Każde logowanie i każda zmiana w rejestrze są zapisywane w dzienniku zdarzeń (kto, co, kiedy i z jakiego adresu).',
      'Numerów PESEL nie wolno udostępniać nikomu poza grą ani wynosić poza panel. Odsłonięcia PESEL są rejestrowane, mogą być limitowane, a nietypowa aktywność wywołuje alerty.',
      'Właściciel może zablokować, zamrozić lub usunąć konto w każdej chwili, także bez podania powodu.',
      'Administratorzy mogą wykonywać działania zbiorcze na wpisach (zmiana statusu, terminu, kosz). Każde takie działanie jest zapisywane w dzienniku, a ostatnie zmiany wpisu można cofnąć.',
    ],
  },
  {
    title: '4. Wnioski i zgłoszenia',
    body: [
      'Kierownictwo składa wnioski o wpis lub zmianę terminu ważności, dołączając zrzut ekranu wiadomości osoby, której wniosek dotyczy. O przyjęciu decyduje administrator.',
      'Formularz „Kontakt i zgłoszenia” może wysłać każdy: w sprawie błędu w danych, prośby o usunięcie wpisu, pytania albo problemu technicznego. Po wysłaniu dostajesz numer zgłoszenia, po którym sprawdzisz jego status. Nie należy w zgłoszeniach podawać prawdziwych danych osobowych.',
      'Właściciel strony może czasowo wyłączyć przyjmowanie zgłoszeń lub wniosków, np. w czasie przerwy technicznej.',
    ],
  },
  {
    title: '5. Odpowiedzialność i zmiany',
    body: [
      'Strona jest udostępniana w obecnej postaci, bez gwarancji ciągłości działania. Administratorzy mogą w każdej chwili zamknąć rejestr (tryb awaryjny), zmienić lub usunąć wpisy.',
      'Regulamin może się zmieniać; zmiany strony są opisywane w dzienniku zmian.',
    ],
  },
]

function Terms() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <h1 className="font-[family-name:var(--font-heading)] text-3xl font-bold text-[var(--registry-navy)] sm:text-4xl">
        Regulamin
      </h1>
      <p className="mt-3 text-muted-foreground">Zasady korzystania z fikcyjnego rejestru.</p>
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
      <LegalVersionInfo versions={TERMS_VERSIONS} />
      <p className="mt-6 text-sm text-muted-foreground">
        Zobacz też <Link to="/prywatnosc" className="underline">politykę prywatności</Link> i{' '}
        <Link to="/jak-to-dziala" className="underline">stronę „Jak to działa”</Link>.
      </p>
    </div>
  )
}
