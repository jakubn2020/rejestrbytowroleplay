import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Printer } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { makeQr, qrPath } from '@/lib/qr'
import {
  BADGE_TITLES,
  CERTIFICATE_ISSUER,
  ENTRY_STATUSES,
  professionKind,
  verificationPath,
  type ProfessionKind,
} from '@/lib/registry'
import { getBadge } from '@/lib/registry.functions'

export const Route = createFileRoute('/plakietka/$id')({
  head: () => ({
    meta: [
      { title: 'Plakietka – Centralny Rejestr' },
      { name: 'robots', content: 'noindex' },
    ],
  }),
  component: BadgePage,
})

type Badge = NonNullable<Awaited<ReturnType<typeof getBadge>>>

type State =
  | { phase: 'loading' }
  | { phase: 'missing' }
  | { phase: 'error' }
  | { phase: 'ready'; badge: Badge }

const THEMES: Record<
  ProfessionKind,
  { background: string; accent: string; stripe: string }
> = {
  doctor: {
    background: 'linear-gradient(135deg, #e3f3f5 0%, #b7dde2 55%, #eaf6f7 100%)',
    accent: '#1f6f7a',
    stripe: '#2a8c9c',
  },
  nurse: {
    background: 'linear-gradient(135deg, #e4f3e7 0%, #cfe6d4 45%, #ecd9e6 100%)',
    accent: '#2f6b45',
    stripe: '#8a4a6b',
  },
  paramedic: {
    background: 'linear-gradient(135deg, #e5ebf7 0%, #cdd7ee 50%, #f3d9de 100%)',
    accent: '#1d3b7a',
    stripe: '#b3262e',
  },
}

function BadgePage() {
  const { id } = Route.useParams()
  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    let active = true
    const numeric = Number(id)
    if (!Number.isInteger(numeric) || numeric <= 0) {
      setState({ phase: 'missing' })
      return
    }
    getBadge({ data: { id: numeric } })
      .then((badge) => {
        if (active) setState(badge ? { phase: 'ready', badge } : { phase: 'missing' })
      })
      .catch(() => {
        if (active) setState({ phase: 'error' })
      })
    return () => {
      active = false
    }
  }, [id])

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 print:max-w-none print:p-0">
      <div className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
        {state.phase === 'ready' && (
          <Button onClick={() => window.print()}>
            <Printer className="size-4" /> Drukuj plakietkę
          </Button>
        )}
        <Button asChild variant="outline">
          <a href="/admin">Wróć do panelu</a>
        </Button>
      </div>

      {state.phase === 'loading' && (
        <p className="text-muted-foreground print:hidden">Wczytywanie…</p>
      )}
      {state.phase === 'missing' && (
        <p className="rounded-lg border border-dashed bg-white px-5 py-8 text-center text-muted-foreground print:hidden">
          Nie znaleziono wpisu. Plakietki są dostępne tylko po zalogowaniu jako
          kierownictwo lub administrator.
        </p>
      )}
      {state.phase === 'error' && (
        <p
          role="alert"
          className="rounded-lg border border-dashed bg-white px-5 py-8 text-center text-destructive print:hidden"
        >
          Nie udało się wczytać plakietki. Zaloguj się w panelu i spróbuj ponownie.
        </p>
      )}
      {state.phase === 'ready' && <BadgeView badge={state.badge} />}
    </div>
  )
}

function BadgeView({ badge }: { badge: Badge }) {
  const kind = professionKind(badge.profession)
  const theme = THEMES[kind]
  const url = `${window.location.origin}${verificationPath(badge.pwz)}`
  const { d, size } = qrPath(makeQr(url), 1)

  return (
    <div>
      {badge.status !== 'active' && (
        <p
          role="status"
          className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden"
        >
          Wpis ma status „{ENTRY_STATUSES[badge.status]}”. Po zeskanowaniu kodu QR
          ta plakietka pokaże, że wpis jest nieaktualny.
        </p>
      )}

      {/* The card is 85.6 × 54 mm; on screen it is enlarged, when printing it is real size. */}
      <div className="h-[81mm] w-[128.4mm] max-w-full overflow-hidden print:h-[54mm] print:w-[85.6mm]">
        <div
          className="h-[54mm] w-[85.6mm] origin-top-left scale-150 overflow-hidden rounded-[3mm] border border-black/20 print:scale-100"
          style={{ background: theme.background, color: '#10202b' }}
        >
          <div className="flex h-full flex-col p-[3mm]">
            <div className="flex gap-[3mm]">
              <div className="w-[26mm] shrink-0">
                <div className="rounded-[1mm] bg-white p-[1mm]">
                  <svg
                    viewBox={`0 0 ${size} ${size}`}
                    shapeRendering="crispEdges"
                    role="img"
                    aria-label={`Kod QR prowadzący do ${url}`}
                    className="block h-[24mm] w-[24mm]"
                  >
                    <rect width={size} height={size} fill="#fff" />
                    <path d={d} fill="#000" />
                  </svg>
                </div>
                <p className="mt-[1mm] text-center text-[4pt] leading-tight">
                  Zeskanuj, aby sprawdzić, czy wpis jest prawdziwy i aktualny
                </p>
              </div>

              <div className="min-w-0 flex-1">
                <p
                  className="text-[8pt] font-extrabold leading-tight tracking-wide"
                  style={{ color: theme.accent }}
                >
                  PLAKIETKA IDENTYFIKACYJNA
                </p>
                <p
                  className="text-[5.5pt] font-bold uppercase leading-tight"
                  style={{ color: theme.stripe }}
                >
                  {BADGE_TITLES[kind]}
                </p>
                <div
                  className="mt-[1mm] h-[0.4mm] w-full"
                  style={{ background: theme.stripe }}
                />

                <dl className="mt-[1.5mm] space-y-[1.3mm]">
                  <BadgeField label="Imię (imiona) i nazwisko">
                    <span className="text-[8.5pt] font-bold leading-tight">
                      {badge.firstName} {badge.lastName}
                    </span>
                  </BadgeField>
                  <BadgeField label="Tytuł zawodowy">
                    <span className="text-[7.5pt] font-semibold">
                      {BADGE_TITLES[kind].toLowerCase()}
                    </span>
                  </BadgeField>
                  <BadgeField label="Numer PESEL">
                    <span className="break-all font-mono text-[7.5pt] font-semibold">
                      {badge.pesel}
                    </span>
                  </BadgeField>
                  <BadgeField label="Numer seryjny dokumentu">
                    <span className="font-mono text-[7.5pt] font-semibold">
                      {badge.pwz}
                    </span>
                  </BadgeField>
                </dl>
              </div>
            </div>

            <div className="mt-auto border-t border-black/20 pt-[0.8mm] text-[3.6pt] leading-tight">
              <p>{CERTIFICATE_ISSUER}</p>
              <p className="italic">
                Dokument fikcyjny, wystawiony wyłącznie na potrzeby roleplayu.
              </p>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground print:hidden">
        Plakietka zawiera PESEL, dlatego jest widoczna tylko dla kierownictwa i
        administratorów. Kod QR prowadzi do publicznej strony, która pokazuje
        wyłącznie, czy wpis jest prawdziwy i aktualny: {url}
      </p>
    </div>
  )
}

function BadgeField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-[3.8pt] font-semibold uppercase leading-none tracking-wide opacity-70">
        {label}
      </dt>
      <dd className="mt-[0.3mm]">{children}</dd>
    </div>
  )
}
