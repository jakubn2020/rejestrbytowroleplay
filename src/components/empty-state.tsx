import type { ReactNode } from 'react'

type Kind = 'inbox' | 'calm' | 'people' | 'log'

/** Small line illustrations for empty lists (they follow the current text colour). */
function Illustration({ kind }: { kind: Kind }) {
  const common = {
    width: 72,
    height: 72,
    viewBox: '0 0 72 72',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (kind === 'inbox') {
    return (
      <svg {...common}>
        <path d="M10 40l9-22h34l9 22" />
        <path d="M10 40v14a4 4 0 0 0 4 4h44a4 4 0 0 0 4-4V40H46a10 10 0 0 1-20 0H10z" />
      </svg>
    )
  }
  if (kind === 'calm') {
    return (
      <svg {...common}>
        <path d="M36 10l22 8v16c0 14-9 24-22 28C23 58 14 48 14 34V18l22-8z" />
        <path d="M26 35l7 7 13-14" />
      </svg>
    )
  }
  if (kind === 'people') {
    return (
      <svg {...common}>
        <circle cx="26" cy="26" r="9" />
        <path d="M10 56c0-10 7-16 16-16s16 6 16 16" />
        <circle cx="50" cy="29" r="7" />
        <path d="M46 42c9 0 16 5 16 14" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M18 10h26l12 12v38H18z" />
      <path d="M44 10v12h12" />
      <path d="M26 34h20M26 42h20M26 50h12" />
    </svg>
  )
}

export function EmptyState({ kind, children }: { kind: Kind; children: ReactNode }) {
  return (
    <div className="mt-4 flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-8 text-center text-muted-foreground">
      <Illustration kind={kind} />
      <p>{children}</p>
    </div>
  )
}
