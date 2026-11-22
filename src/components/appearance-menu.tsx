import { useEffect, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'

const KEY = 'appearance'

type Appearance = {
  font?: 'serif' | 'system' | 'readable'
  radius?: 'sharp' | 'round'
  oled?: 'on'
  motion?: 'off'
  sticky?: 'off'
  homebg?: 'dots' | 'grid' | 'soft'
}

function read(): Appearance {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Appearance
  } catch {
    return {}
  }
}

/** Mirrors the saved choices onto <html> data attributes (the first paint is set in __root.tsx). */
function apply(next: Appearance) {
  const root = document.documentElement
  for (const key of ['font', 'radius', 'oled', 'motion', 'sticky', 'homebg'] as const) {
    const value = next[key]
    if (value) root.dataset[key] = value
    else delete root.dataset[key]
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // storage may be blocked; the choice then lasts until reload
  }
}

const selectClass = 'h-8 w-full rounded-md border border-input bg-white px-2 text-sm'

/** Personal look settings: font, corners, true-black dark mode, animations, pinned header. */
export function AppearanceMenu() {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<Appearance>({})

  useEffect(() => {
    setState(read())
  }, [])

  function change(patch: Appearance) {
    const next = { ...state, ...patch }
    for (const key of Object.keys(next) as (keyof Appearance)[]) if (!next[key]) delete next[key]
    setState(next)
    apply(next)
  }

  return (
    <div className="relative">
      <Button
        type="button"
        size="icon"
        variant="outline"
        onClick={() => setOpen((value) => !value)}
        aria-label="Wygląd strony"
        aria-expanded={open}
        title="Wygląd strony"
        className="shrink-0 border-white/70 bg-transparent text-white hover:bg-white/10 hover:text-white"
      >
        <SlidersHorizontal aria-hidden />
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 rounded-lg border bg-white p-3 text-sm text-foreground shadow-lg">
          <p className="font-semibold">Wygląd strony</p>
          <p className="text-xs text-muted-foreground">Ustawienia zapamiętane w tej przeglądarce.</p>

          <label className="mt-3 block text-xs text-muted-foreground" htmlFor="ap-font">Czcionka</label>
          <select id="ap-font" className={selectClass} value={state.font ?? ''} onChange={(e) => change({ font: (e.target.value || undefined) as Appearance['font'] })}>
            <option value="">Domyślna</option>
            <option value="serif">Szeryfowa</option>
            <option value="system">Systemowa</option>
            <option value="readable">Duża czytelność</option>
          </select>

          <label className="mt-3 block text-xs text-muted-foreground" htmlFor="ap-radius">Zaokrąglenie rogów</label>
          <select id="ap-radius" className={selectClass} value={state.radius ?? ''} onChange={(e) => change({ radius: (e.target.value || undefined) as Appearance['radius'] })}>
            <option value="sharp">Ostre</option>
            <option value="">Średnie (domyślne)</option>
            <option value="round">Mocno zaokrąglone</option>
          </select>

          <label className="mt-3 block text-xs text-muted-foreground" htmlFor="ap-homebg">Tło strony głównej</label>
          <select id="ap-homebg" className={selectClass} value={state.homebg ?? ''} onChange={(e) => change({ homebg: (e.target.value || undefined) as Appearance['homebg'] })}>
            <option value="">Bez tła</option>
            <option value="dots">Kropki</option>
            <option value="grid">Siatka</option>
            <option value="soft">Łagodny gradient</option>
          </select>

          <label className="mt-3 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={state.oled === 'on'} onChange={(e) => change({ oled: e.target.checked ? 'on' : undefined })} />
            Czarny tryb OLED (w trybie ciemnym)
          </label>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={state.motion !== 'off'} onChange={(e) => change({ motion: e.target.checked ? undefined : 'off' })} />
            Animacje
          </label>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={state.sticky !== 'off'} onChange={(e) => change({ sticky: e.target.checked ? undefined : 'off' })} />
            Przypięty górny pasek (na szerokich ekranach)
          </label>
          <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => { setState({}); apply({}) }}>
            Przywróć domyślne
          </Button>
        </div>
      )}
    </div>
  )
}
