import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const STEPS: { title: string; text: string }[] = [
  {
    title: 'Witaj w panelu kierownictwa',
    text: 'W tym krótkim samouczku zobaczysz, co możesz robić w panelu. Zajmie to minutę, a później wrócisz do niego przyciskiem „Samouczek”.',
  },
  {
    title: '1. Szukanie osób',
    text: 'Pole „Szukaj pracownika” nad tabelą przeszukuje imię, nazwisko, PWZ, zawód i specjalizację. Filtry obok zawężają listę po zawodzie, statusie i osobie, która dodała wpis.',
  },
  {
    title: '2. Numery PESEL',
    text: 'PESEL jest zamaskowany. Kliknięcie go odsłania numer, ale każde odsłonięcie jest zapisywane w dzienniku, a przy zbyt wielu odsłonięciach pojawia się alert (możliwy jest też dzienny limit). Odsłaniaj tylko wtedy, gdy naprawdę potrzebujesz.',
  },
  {
    title: '3. Wniosek o wpis',
    text: 'Nowej osoby nie dodajesz sam. Składasz wniosek z numerem PESEL, zawodem i zrzutem ekranu wiadomości, w której osoba prosi o wpis. Decyduje administrator. Wnioski możesz składać nie częściej niż co 5 minut.',
  },
  {
    title: '4. Zmiana terminu ważności',
    text: 'Ikona kalendarza w tabeli otwiera wniosek o zmianę terminu PWZ (dożywotnio, 3 miesiące albo własna liczba dni lub miesięcy). Również wymaga zrzutu ekranu. Nowy termin liczy się od dnia akceptacji.',
  },
  {
    title: '5. Plakietki',
    text: 'Przy każdej osobie jest przycisk plakietki z kodem QR do weryfikacji. Plakietkę możesz wydrukować albo zapisać. Kod prowadzi na stronę z dużym TAK lub NIE.',
  },
  {
    title: '6. Twoje wnioski i odznaki',
    text: 'Pod formularzem widzisz swoje wnioski i decyzje administratorów. Za przyjęte wnioski dostajesz odznaki: Początkujący (1), Sprawny (10), Doświadczony (50) i Mistrz wniosków (100).',
  },
  {
    title: '7. Bezpieczeństwo',
    text: 'Nie udostępniaj nikomu hasła ani danych z panelu. Na panelu widnieje Twój adres e-mail jako znak wodny, a logowanie z nowego urządzenia jest zgłaszane administratorom. Jeśli zauważysz coś podejrzanego, zgłoś to administratorowi.',
  },
]

/** kierownictwo: step-by-step introduction, shown automatically on the first sign-in. */
export function OnboardingDialog({
  email,
  open,
  onOpenChange,
}: {
  email: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  function finish() {
    try {
      localStorage.setItem(`onboarding-done:${email}`, '1')
    } catch {
      // it may show again next time
    }
    onOpenChange(false)
  }

  const last = step === STEPS.length - 1
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : finish())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{STEPS[step].title}</DialogTitle>
          <DialogDescription>
            Krok {step + 1} z {STEPS.length}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">{STEPS[step].text}</p>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={finish}>
            Pomiń
          </Button>
          {step > 0 && (
            <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
              Wstecz
            </Button>
          )}
          <Button type="button" onClick={() => (last ? finish() : setStep(step + 1))}>
            {last ? 'Zakończ' : 'Dalej'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function onboardingSeen(email: string): boolean {
  try {
    return localStorage.getItem(`onboarding-done:${email}`) === '1'
  } catch {
    return true
  }
}
