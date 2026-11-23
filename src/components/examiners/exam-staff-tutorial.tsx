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

type Step = { title: string; text: string }

const EXAMINER_STEPS: Step[] = [
  {
    title: 'Witaj w panelu egzaminatora',
    text: 'Krótki samouczek pokaże Ci, co możesz tu robić. Wrócisz do niego w każdej chwili przyciskiem „Samouczek”.',
  },
  {
    title: '1. Wniosek o wpis do rejestru',
    text: 'Nowej osoby nie dodajesz sam. Składasz wniosek: imię, nazwisko, PESEL, zawód i zrzut ekranu wiadomości, w której osoba prosi o wpis. Decyduje administrator.',
  },
  {
    title: '2. Limit wniosków',
    text: 'Właściciel strony ustala, ile wniosków możesz złożyć w danym czasie (domyślnie 2 na 20 minut). Pasek limitu pokazuje, ile jeszcze możesz wysłać, a po wyczerpaniu odlicza czas do kolejnego wniosku.',
  },
  {
    title: '3. Szkic i podgląd',
    text: 'Formularz zapisuje szkic w Twojej przeglądarce, więc odświeżenie strony niczego nie kasuje. PWZ wylicza się automatycznie z numeru PESEL.',
  },
  {
    title: '4. Moje wnioski',
    text: 'Pod formularzem widzisz swoje wnioski, ich status i uwagę administratora. Kafelki na górze pokazują, ile wniosków zostało przyjętych, a wykres, jak aktywny byłeś w ostatnich dwóch tygodniach.',
  },
  {
    title: '5. Bezpieczeństwo konta',
    text: 'Przy pierwszym logowaniu zmieniasz hasło, które ustawił moderator. Nie udostępniaj hasła nikomu. Moderator może zawiesić Twoje konto, a decyzję o jego usunięciu podejmuje administrator.',
  },
]

const MODERATOR_STEPS: Step[] = [
  {
    title: 'Witaj w panelu moderatora egzaminatorów',
    text: 'Zobaczysz, jak zarządzać kontami egzaminatorów. Samouczek wróci pod przyciskiem „Samouczek”.',
  },
  {
    title: '1. Dodawanie egzaminatorów',
    text: 'Wpisujesz adres e-mail i hasło początkowe (przycisk „Losuj” tworzy mocne hasło). Egzaminator zmieni je przy pierwszym logowaniu. Przekaż mu hasło bezpiecznym kanałem.',
  },
  {
    title: '2. Zawieszanie',
    text: 'Zawieszenie na wybrany czas (1 godz., 1 dzień, 7 dni lub własna liczba godzin) wylogowuje egzaminatora i blokuje logowanie. Możesz je zdjąć w każdej chwili. Najdłuższe zawieszenie ogranicza właściciel.',
  },
  {
    title: '3. Wniosek o usunięcie konta',
    text: 'Konta nie usuwasz sam. Składasz wniosek z powodem, a administrator go akceptuje lub odrzuca. Status wniosków widzisz na liście.',
  },
  {
    title: '4. Limity',
    text: 'Właściciel ustala, ile kont możesz dodać na dobę, ile wniosków o usunięcie złożyć i ile kont egzaminatorów może istnieć. Aktualne zużycie widać na górze panelu.',
  },
  {
    title: '5. Przegląd aktywności',
    text: 'Przy każdym egzaminatorze widać ostatnie logowanie oraz liczbę wniosków z ostatnich 7 dni i przyjętych łącznie. Pomaga to wyłapać konta nieużywane albo nadużywające limitów.',
  },
]

export type TutorialKind = 'examiner' | 'moderator'

const storageKey = (kind: TutorialKind, email: string) => `exam-tutorial-done:${kind}:${email}`

export function examTutorialSeen(kind: TutorialKind, email: string): boolean {
  try {
    return localStorage.getItem(storageKey(kind, email)) === '1'
  } catch {
    return true
  }
}

/** Step-by-step introduction for examiners and moderators; shown by itself at the first sign-in. */
export function ExamStaffTutorial({
  kind,
  email,
  open,
  onOpenChange,
}: {
  kind: TutorialKind
  email: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const steps = kind === 'moderator' ? MODERATOR_STEPS : EXAMINER_STEPS
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (open) setStep(0)
  }, [open])

  function finish() {
    try {
      localStorage.setItem(storageKey(kind, email), '1')
    } catch {
      // it may show again next time
    }
    onOpenChange(false)
  }

  const last = step === steps.length - 1
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : finish())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{steps[step].title}</DialogTitle>
          <DialogDescription>
            Krok {step + 1} z {steps.length}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">{steps[step].text}</p>
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
