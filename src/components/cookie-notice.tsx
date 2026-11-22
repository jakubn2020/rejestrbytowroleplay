import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'

const KEY = 'cookie-notice-ok'

/** One-time notice: the site only uses essential storage (no ads, no tracking cookies). */
export function CookieNotice() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) !== '1') setOpen(true)
    } catch {
      setOpen(true)
    }
  }, [])

  function accept() {
    setOpen(false)
    try {
      localStorage.setItem(KEY, '1')
    } catch {
      // it will show again next time
    }
  }

  if (!open) return null
  return (
    <div
      role="region"
      aria-label="Informacja o plikach cookie"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-3xl flex-col gap-3 rounded-lg border bg-white p-4 text-sm shadow-lg sm:flex-row sm:items-center print:hidden"
    >
      <p className="flex-1">
        Ta strona używa tylko niezbędnej pamięci przeglądarki: do logowania personelu i zapamiętania Twoich ustawień
        wyglądu. Nie używamy reklamowych ani śledzących plików cookie.{' '}
        <Link to="/prywatnosc" className="underline">Polityka prywatności</Link>
      </p>
      <Button type="button" size="sm" onClick={accept}>
        Rozumiem
      </Button>
    </div>
  )
}
