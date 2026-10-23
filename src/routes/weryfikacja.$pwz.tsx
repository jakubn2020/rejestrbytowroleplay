import { Link, createFileRoute } from '@tanstack/react-router'
import { Check, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { verifyEntry, type VerifyResult } from '@/lib/registry.functions'

export const Route = createFileRoute('/weryfikacja/$pwz')({
  head: () => ({
    meta: [
      { title: 'Weryfikacja wpisu – Centralny Rejestr' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
  loader: async ({ params }): Promise<VerifyResult> => {
    if (!/^\d{7}$/.test(params.pwz)) return { status: 'not_found', pwz: params.pwz }
    return verifyEntry({ data: { pwz: params.pwz } })
  },
  component: VerifyPage,
})

function reason(result: VerifyResult): string {
  switch (result.status) {
    case 'valid':
      return 'Wpis w rejestrze jest prawdziwy i aktualny.'
    case 'suspended':
      return 'Wpis jest zawieszony, więc nie jest aktualny.'
    case 'inactive':
      return 'Wpis jest nieaktywny, więc nie jest aktualny.'
    case 'limited':
      return 'Zbyt wiele zapytań. Spróbuj ponownie za minutę.'
    default:
      return 'W rejestrze nie ma wpisu o takim numerze.'
  }
}

function VerifyPage() {
  const result = Route.useLoaderData()
  const valid = result.status === 'valid'
  const limited = result.status === 'limited'

  return (
    <div className="mx-auto max-w-xl px-5 py-12 sm:py-16">
      <h1 className="font-[family-name:var(--font-heading)] text-2xl font-bold text-[var(--registry-navy)]">
        Weryfikacja wpisu
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Numer seryjny (PWZ): <span className="font-mono">{result.pwz}</span>
      </p>

      <div
        role="status"
        className={`mt-6 rounded-lg border-2 px-6 py-8 text-center ${
          valid
            ? 'border-emerald-300 bg-emerald-50'
            : limited
              ? 'border-amber-300 bg-amber-50'
              : 'border-red-300 bg-red-50'
        }`}
      >
        {!limited && (
          <div
            className={`mx-auto flex size-16 items-center justify-center rounded-full text-white ${
              valid ? 'bg-emerald-600' : 'bg-red-600'
            }`}
          >
            {valid ? <Check className="size-10" /> : <X className="size-10" />}
          </div>
        )}
        {!limited && (
          <p
            className={`mt-4 text-5xl font-extrabold ${
              valid ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {valid ? 'TAK' : 'NIE'}
          </p>
        )}
        <p className="mt-3 text-lg">{reason(result)}</p>
        {result.status === 'valid' && (
          <p className="mt-4 text-base">
            <strong>
              {result.firstName} {result.lastName}
            </strong>
            <br />
            {result.profession}
          </p>
        )}
      </div>

      <div className="mt-6">
        <Button asChild variant="outline">
          <Link to="/">Wyszukiwarka rejestru</Link>
        </Button>
      </div>
    </div>
  )
}
