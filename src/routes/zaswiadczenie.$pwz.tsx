import { Link, createFileRoute } from '@tanstack/react-router'
import { Printer } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  getCertificate,
  type CertificateResult,
} from '@/lib/certificate.functions'
import { CERTIFICATE_ISSUER, ENTRY_STATUSES, formatDate } from '@/lib/registry'

export const Route = createFileRoute('/zaswiadczenie/$pwz')({
  head: () => ({
    meta: [
      { title: 'Zaświadczenie o posiadaniu tytułu' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
  loader: async ({ params }): Promise<CertificateResult> => {
    if (!/^\d{7}$/.test(params.pwz)) return { status: 'not_found' }
    return getCertificate({ data: { pwz: params.pwz } })
  },
  component: CertificatePage,
})

function message(result: Exclude<CertificateResult, { status: 'ok' }>) {
  switch (result.status) {
    case 'not_found':
      return 'Nie znaleziono wpisu o takim numerze PWZ.'
    case 'unavailable':
      return `Wpis ma status „${ENTRY_STATUSES[result.entryStatus]}”, więc zaświadczenie nie może zostać wydane.`
    case 'limited':
      return 'Zbyt wiele zapytań. Spróbuj ponownie za minutę.'
  }
}

function CertificatePage() {
  const result = Route.useLoaderData()

  return (
    <div className="mx-auto max-w-[210mm] px-5 py-8 print:max-w-none print:p-0">
      <div className="mb-6 flex flex-wrap gap-2 print:hidden">
        {result.status === 'ok' && (
          <Button onClick={() => window.print()}>
            <Printer className="size-4" /> Drukuj / zapisz jako PDF
          </Button>
        )}
        <Button asChild variant="outline">
          <Link to="/">Wróć do wyszukiwarki</Link>
        </Button>
      </div>

      {result.status !== 'ok' ? (
        <div className="rounded-lg border border-dashed bg-white px-5 py-8 text-center text-muted-foreground">
          {message(result)}
        </div>
      ) : (
        <article className="flex min-h-[270mm] flex-col border-2 border-[var(--registry-navy)] bg-white p-8 shadow-sm sm:p-12 print:min-h-[270mm] print:border print:p-10 print:shadow-none">
          <header className="text-center">
            <p className="text-sm font-semibold uppercase leading-relaxed tracking-wide text-[var(--registry-navy)]">
              {CERTIFICATE_ISSUER}
            </p>
            <div className="mx-auto mt-4 h-px w-40 bg-[var(--registry-red)]" />
          </header>

          <div className="mt-12 text-center">
            <h1 className="font-[family-name:var(--font-heading)] text-4xl font-bold tracking-[0.2em] text-[var(--registry-navy)]">
              ZAŚWIADCZENIE
            </h1>
            <p className="mt-2 text-xl">o posiadaniu tytułu</p>
          </div>

          <div className="mt-12 space-y-5 text-center text-lg leading-relaxed">
            <p>Niniejszym zaświadcza się, że</p>
            <p className="font-[family-name:var(--font-heading)] text-3xl font-bold">
              {result.entry.firstName} {result.entry.lastName}
            </p>
            <p>legitymujący(-a) się numerem prawa wykonywania zawodu (PWZ)</p>
            <p className="font-mono text-2xl tracking-wider">
              {result.entry.pwz}
            </p>
            <p>posiada tytuł</p>
            <p className="text-2xl font-semibold">{result.entry.profession}</p>
            {result.entry.specialization && (
              <p>
                w specjalizacji:{' '}
                <strong>{result.entry.specialization}</strong>
              </p>
            )}
          </div>

          <p className="mt-10 text-center text-sm text-muted-foreground">
            Wpis w Centralnym Rejestrze Lekarzy, Pielęgniarzy i Ratowników
            Medycznych: numer {result.entry.entryNumber}, data wpisu{' '}
            {formatDate(result.entry.entryDate)}.
          </p>

          <div className="mt-auto grid grid-cols-2 items-end gap-8 pt-16">
            <div className="text-sm">
              <p>Milanów, dnia {formatDate(result.issuedAt)}</p>
            </div>
            <div className="text-center">
              <div className="flex h-36 items-center justify-center">
                {result.seal ? (
                  <img
                    src={result.seal}
                    alt="Pieczęć"
                    className="max-h-36 max-w-full object-contain"
                  />
                ) : (
                  <div className="flex size-32 items-center justify-center rounded-full border-2 border-dashed text-xs text-muted-foreground">
                    miejsce na pieczęć
                  </div>
                )}
              </div>
              <div className="mt-2 border-t pt-1 text-xs text-muted-foreground">
                Pieczęć
              </div>
            </div>
          </div>

          <p className="mt-10 text-center text-xs italic text-muted-foreground">
            Dokument fikcyjny, wystawiony wyłącznie na potrzeby roleplayu. Nie
            ma mocy prawnej.
          </p>
        </article>
      )}
    </div>
  )
}
