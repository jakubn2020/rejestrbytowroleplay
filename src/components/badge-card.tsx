import type { CSSProperties, ReactNode } from 'react'

import { makeQr, qrPath } from '@/lib/qr'
import {
  BADGE_TITLES,
  CERTIFICATE_ISSUER,
  professionKind,
  validityLabel,
  type ProfessionKind,
} from '@/lib/registry'

export type BadgeLayout = 'horizontal' | 'vertical' | 'mini'

export const BADGE_LAYOUTS: { key: BadgeLayout; label: string }[] = [
  { key: 'horizontal', label: 'Pozioma' },
  { key: 'vertical', label: 'Pionowa' },
  { key: 'mini', label: 'Mini' },
]

/** Card size in millimetres (ID-1 card; the mini one is a short strip). */
const SIZES: Record<BadgeLayout, { w: number; h: number }> = {
  horizontal: { w: 85.6, h: 54 },
  vertical: { w: 54, h: 85.6 },
  mini: { w: 85.6, h: 28 },
}

const THEMES: Record<ProfessionKind, { background: string; accent: string; stripe: string }> = {
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

export type BadgeData = {
  firstName: string
  lastName: string
  pesel: string
  pwz: string
  profession: string
  expiresAt: string | null
}

function Qr({ url, mm }: { url: string; mm: number }) {
  const { d, size } = qrPath(makeQr(url), 1)
  return (
    <div className="rounded-[1mm] p-[1mm]" style={{ background: '#fff' }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        shapeRendering="crispEdges"
        role="img"
        aria-label={`Kod QR prowadzący do ${url}`}
        className="block"
        style={{ width: `${mm}mm`, height: `${mm}mm` }}
      >
        <rect width={size} height={size} fill="#fff" />
        <path d={d} fill="#000" />
      </svg>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[3.8pt] font-semibold uppercase leading-none tracking-wide opacity-70">{label}</dt>
      <dd className="mt-[0.3mm]">{children}</dd>
    </div>
  )
}

/**
 * The badge in one of three layouts. Without `scale` it follows the page: enlarged on screen
 * and real size when printed; with `scale` (e.g. in a preview) it has that fixed scale.
 */
export function BadgeCard({
  badge,
  url,
  layout = 'horizontal',
  scale,
}: {
  badge: BadgeData
  url: string
  layout?: BadgeLayout
  scale?: number
}) {
  const kind = professionKind(badge.profession)
  const theme = THEMES[kind]
  const { w, h } = SIZES[layout]
  const wrapperStyle: CSSProperties & Record<string, string | number> = {
    width: `calc(${w}mm * var(--s))`,
    height: `calc(${h}mm * var(--s))`,
  }
  if (scale !== undefined) wrapperStyle['--s'] = scale
  const name = `${badge.firstName} ${badge.lastName}`.trim()
  const footer = (
    <div className="mt-auto border-t border-black/20 pt-[0.8mm] text-[3.6pt] leading-tight">
      <p>
        {CERTIFICATE_ISSUER} · Ważność: {validityLabel(badge.expiresAt)}
      </p>
      <p className="italic">Dokument fikcyjny, wystawiony wyłącznie na potrzeby roleplayu.</p>
    </div>
  )
  const heading = (
    <>
      <p className="text-[8pt] font-extrabold leading-tight tracking-wide" style={{ color: theme.accent }}>
        PRAWO WYKONYWANIA ZAWODU
      </p>
      <p className="text-[6.5pt] font-bold leading-tight" style={{ color: theme.stripe }}>
        {BADGE_TITLES[kind]}
      </p>
      <div className="mt-[1mm] h-[0.4mm] w-full" style={{ background: theme.stripe }} />
    </>
  )

  return (
    <div className={`max-w-full overflow-hidden ${scale === undefined ? 'badge-scale' : ''}`} style={wrapperStyle}>
      <div
        className="origin-top-left overflow-hidden rounded-[3mm] border border-black/20"
        style={{
          width: `${w}mm`,
          height: `${h}mm`,
          transform: 'scale(var(--s))',
          background: theme.background,
          color: '#10202b',
        }}
      >
        {layout === 'horizontal' && (
          <div className="flex h-full flex-col p-[3mm]">
            <div className="flex gap-[3mm]">
              <div className="w-[26mm] shrink-0">
                <Qr url={url} mm={24} />
                <p className="mt-[1mm] text-center text-[4pt] leading-tight">
                  Zeskanuj, aby sprawdzić, czy wpis jest prawdziwy i aktualny
                </p>
              </div>
              <div className="min-w-0 flex-1">
                {heading}
                <dl className="mt-[1.5mm] space-y-[1.3mm]">
                  <Field label="Imię (imiona) i nazwisko">
                    <span className="text-[8.5pt] font-bold leading-tight">{name}</span>
                  </Field>
                  <Field label="Tytuł zawodowy">
                    <span className="text-[7.5pt] font-semibold">{BADGE_TITLES[kind]}</span>
                  </Field>
                  <Field label="Numer PESEL">
                    <span className="break-all font-mono text-[7.5pt] font-semibold">{badge.pesel}</span>
                  </Field>
                  <Field label="Numer seryjny dokumentu">
                    <span className="font-mono text-[7.5pt] font-semibold">{badge.pwz}</span>
                  </Field>
                </dl>
              </div>
            </div>
            {footer}
          </div>
        )}

        {layout === 'vertical' && (
          <div className="flex h-full flex-col p-[3mm]">
            {heading}
            <div className="mt-[2mm] flex flex-col items-center">
              <Qr url={url} mm={30} />
              <p className="mt-[1mm] text-center text-[4pt] leading-tight">
                Zeskanuj, aby sprawdzić, czy wpis jest prawdziwy i aktualny
              </p>
            </div>
            <dl className="mt-[2mm] space-y-[1.3mm]">
              <Field label="Imię (imiona) i nazwisko">
                <span className="text-[8.5pt] font-bold leading-tight">{name}</span>
              </Field>
              <Field label="Numer PESEL">
                <span className="break-all font-mono text-[7.5pt] font-semibold">{badge.pesel}</span>
              </Field>
              <Field label="Numer seryjny dokumentu">
                <span className="font-mono text-[7.5pt] font-semibold">{badge.pwz}</span>
              </Field>
            </dl>
            {footer}
          </div>
        )}

        {layout === 'mini' && (
          <div className="flex h-full flex-col p-[2mm]">
            <div className="flex gap-[2.5mm]">
              <div className="shrink-0">
                <Qr url={url} mm={17} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[5.5pt] font-extrabold leading-tight tracking-wide" style={{ color: theme.accent }}>
                  PRAWO WYKONYWANIA ZAWODU · {BADGE_TITLES[kind]}
                </p>
                <p className="mt-[0.8mm] text-[8pt] font-bold leading-tight">{name}</p>
                <p className="mt-[0.6mm] font-mono text-[6.5pt] font-semibold">PWZ {badge.pwz}</p>
              </div>
            </div>
            <p className="mt-auto text-[3.4pt] italic leading-tight">
              Dokument fikcyjny, wystawiony wyłącznie na potrzeby roleplayu.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
