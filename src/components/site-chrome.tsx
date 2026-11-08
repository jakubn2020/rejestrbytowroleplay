import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { LogIn, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'

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

export function SiteHeader() {
  // Identity emails (invite, password recovery) link to the site root;
  // forward their tokens to the admin page, which handles them.
  useEffect(() => {
    const hash = window.location.hash
    if (
      window.location.pathname !== '/admin' &&
      /(invite|recovery|confirmation)_token=/.test(hash)
    ) {
      window.location.replace(`/admin${hash}`)
    }
  }, [])

  return (
    <header className="bg-[var(--registry-navy)] text-white print:hidden">
      <div className="h-1 bg-[var(--registry-red)]" />
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4">
        <Link
          to="/"
          className="font-[family-name:var(--font-heading)] text-lg leading-tight font-semibold sm:text-xl"
        >
          Centralny Rejestr Lekarzy, Pielęgniarzy i Ratowników Medycznych
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <Button
            asChild
            size="sm"
            variant="outline"
            className="shrink-0 border-white/70 bg-transparent text-white hover:bg-white/10 hover:text-white"
          >
            <Link to="/admin">
              <LogIn aria-hidden />
              <span className="hidden sm:inline">Logowanie administratora</span>
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
      </p>
    </footer>
  )
}
