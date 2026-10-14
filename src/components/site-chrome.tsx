import { useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { LogIn } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
    <header className="bg-[var(--registry-navy)] text-white">
      <div className="h-1 bg-[var(--registry-red)]" />
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4">
        <Link
          to="/"
          className="font-[family-name:var(--font-heading)] text-lg leading-tight font-semibold sm:text-xl"
        >
          Centralny Rejestr Lekarzy, Pielęgniarzy i Ratowników Medycznych
        </Link>
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
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="border-t bg-white">
      <p className="mx-auto max-w-5xl px-5 py-6 text-center text-sm text-muted-foreground">
        Centralny Rejestr Lekarzy, Pielęgniarzy i Ratowników Medycznych - Strona
        Fikcyjna Na Potrzeby Roleplayu
      </p>
    </footer>
  )
}
