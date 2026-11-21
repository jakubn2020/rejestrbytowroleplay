import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { LogIn, Moon, Palette, Sun } from 'lucide-react'
import { CountBadge } from '@/components/count-badge'
import { Button } from '@/components/ui/button'
import { getHeaderBadge } from '@/lib/alerts.functions'
import { SITE_VERSION } from '@/lib/changelog'
import { getSiteStatus } from '@/lib/site.functions'
import { trackVisit } from '@/lib/visits.functions'

/** Light/dark switch; the choice is remembered in this browser (the first paint is set in __root.tsx). */
function ThemeToggle() {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light')
    } catch {
      // storage may be blocked; the choice then lasts until reload
    }
  }

  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      onClick={toggle}
      aria-label={dark ? 'Włącz tryb jasny' : 'Włącz tryb ciemny'}
      title={dark ? 'Tryb jasny' : 'Tryb ciemny'}
      className="shrink-0 border-white/70 bg-transparent text-white hover:bg-white/10 hover:text-white"
    >
      {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  )
}

const PALETTES: { name: string; hue: number }[] = [
  { name: 'Granat (domyślny)', hue: 258 },
  { name: 'Zieleń szpitalna', hue: 165 },
  { name: 'Turkus', hue: 205 },
  { name: 'Fiolet', hue: 305 },
  { name: 'Bordo', hue: 10 },
  { name: 'Bursztyn', hue: 70 },
]

function applyHue(hue: number | null) {
  const root = document.documentElement
  if (hue === null) root.style.removeProperty('--hue')
  else root.style.setProperty('--hue', String(hue))
  try {
    if (hue === null) localStorage.removeItem('palette-hue')
    else localStorage.setItem('palette-hue', String(hue))
  } catch {
    // storage may be blocked; the choice then lasts until reload
  }
}

/** Colour theme picker: ready-made palettes or a custom hue; remembered in this browser. */
function PaletteMenu() {
  const [open, setOpen] = useState(false)
  const [hue, setHue] = useState(258)

  useEffect(() => {
    try {
      const saved = parseInt(localStorage.getItem('palette-hue') ?? '', 10)
      if (saved >= 0 && saved <= 360) setHue(saved)
    } catch {
      // ignore
    }
  }, [])

  function choose(next: number | null) {
    setHue(next ?? 258)
    applyHue(next)
  }

  return (
    <div className="relative">
      <Button
        type="button"
        size="icon"
        variant="outline"
        onClick={() => setOpen((value) => !value)}
        aria-label="Motyw kolorystyczny"
        aria-expanded={open}
        title="Motyw kolorystyczny"
        className="shrink-0 border-white/70 bg-transparent text-white hover:bg-white/10 hover:text-white"
      >
        <Palette aria-hidden />
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-64 rounded-lg border bg-white p-3 text-sm text-foreground shadow-lg">
          <p className="font-semibold">Motyw kolorystyczny</p>
          <ul className="mt-2 space-y-1">
            {PALETTES.map((palette) => (
              <li key={palette.name}>
                <button
                  type="button"
                  onClick={() => choose(palette.hue === 258 ? null : palette.hue)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-muted"
                >
                  <span
                    aria-hidden
                    className="size-4 rounded-full border"
                    style={{ background: `oklch(0.4 0.12 ${palette.hue})` }}
                  />
                  {palette.name}
                </button>
              </li>
            ))}
          </ul>
          <label className="mt-3 block text-xs text-muted-foreground" htmlFor="palette-hue">
            Własny kolor
          </label>
          <input
            id="palette-hue"
            type="range"
            min={0}
            max={360}
            value={hue}
            onChange={(e) => choose(Number(e.target.value))}
            className="mt-1 h-2 w-full cursor-pointer appearance-none rounded-full"
            style={{
              background:
                'linear-gradient(to right, oklch(0.55 0.15 0), oklch(0.55 0.15 60), oklch(0.55 0.15 120), oklch(0.55 0.15 180), oklch(0.55 0.15 240), oklch(0.55 0.15 300), oklch(0.55 0.15 360))',
            }}
          />
        </div>
      )}
    </div>
  )
}

export function SiteHeader() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [badge, setBadge] = useState<number | null>(null)
  const [closed, setClosed] = useState<string | null>(null)

  // Anonymous visit counter (not the admin panel or badges).
  useEffect(() => {
    if (pathname.startsWith('/admin') || pathname.startsWith('/plakietka')) return
    trackVisit({ data: { path: pathname } }).catch(() => undefined)
  }, [pathname])

  // Emergency mode banner.
  useEffect(() => {
    let active = true
    getSiteStatus()
      .then((status) => {
        if (active) setClosed(status.closed ? status.message : null)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [pathname])

  // Red circle for signed-in admins when something waits for them.
  useEffect(() => {
    let active = true
    const load = () =>
      getHeaderBadge()
        .then((result) => {
          if (active) setBadge(result.count)
        })
        .catch(() => undefined)
    void load()
    const timer = setInterval(load, 60_000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [pathname])

  return (
    <header className="bg-[var(--registry-navy)] text-white print:hidden">
      <div className="h-1 bg-[var(--registry-red)]" />
      {closed && (
        <div role="alert" className="bg-red-700 px-5 py-2 text-center text-sm font-semibold text-white">
          Tryb awaryjny: {closed}
        </div>
      )}
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4">
        <Link
          to="/"
          className="font-[family-name:var(--font-heading)] text-lg leading-tight font-semibold sm:text-xl"
        >
          Centralny Rejestr Lekarzy, Pielęgniarzy i Ratowników Medycznych
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          <PaletteMenu />
          <ThemeToggle />
          <Button
            asChild
            size="sm"
            variant="outline"
            className="relative shrink-0 border-white/70 bg-transparent text-white hover:bg-white/10 hover:text-white"
          >
            <Link to="/admin">
              <LogIn aria-hidden />
              <CountBadge count={badge ?? 0} />
              <span className="hidden sm:inline">
                {badge !== null ? 'Panel administratora' : 'Logowanie administratora'}
              </span>
              <span className="sm:hidden">Admin</span>
            </Link>
          </Button>
        </div>
      </div>
      <nav
        aria-label="Menu"
        className="mx-auto flex max-w-5xl gap-5 px-5 pb-3 text-sm text-white/85"
      >
        <Link to="/" className="hover:text-white hover:underline">
          Wyszukiwarka
        </Link>
        <Link to="/jak-to-dziala" className="hover:text-white hover:underline">
          Jak to działa
        </Link>
        <Link to="/zglos-blad" className="hover:text-white hover:underline">
          Zgłoś błąd
        </Link>
        <Link to="/zmiany" className="hover:text-white hover:underline">
          Dziennik zmian
        </Link>
      </nav>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t bg-white print:hidden">
      <p className="mx-auto max-w-5xl px-5 py-6 text-center text-sm text-muted-foreground">
        Centralny Rejestr Lekarzy, Pielęgniarzy i Ratowników Medycznych - Strona
        Fikcyjna Na Potrzeby Roleplayu
        <span className="mt-1 block text-xs">Wersja {SITE_VERSION}</span>
      </p>
    </footer>
  )
}
