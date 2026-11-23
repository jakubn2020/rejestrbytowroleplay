import { useEffect, useState } from "react";
import type { Role } from "./examiners-types";
import "./examiners.css";

const STEPS: Partial<Record<Role, { title: string; body: string }[]>> = {
  egzaminator: [
    { title: "Składanie wniosku", body: "Wybierz zawód, wpisz imię i nazwisko oraz numer PWZ, potem kliknij „Wyślij wniosek”." },
    { title: "Limit", body: "Możesz złożyć ograniczoną liczbę wniosków w oknie czasowym. Licznik nad formularzem pokazuje, ile zostało i kiedy limit się odnowi." },
    { title: "Statusy", body: "„oczekuje” – czeka na decyzję. „przyjęty” – jesteś w rejestrze. „odrzucony” – zobaczysz powód i możesz złożyć nowy wniosek." },
    { title: "Powiadomienia i odznaki", body: "Dzwonek w nagłówku informuje o decyzjach. Za przyjęte wnioski dostajesz odznaki, a najlepszy w miesiącu zostaje Egzaminatorem miesiąca." },
  ],
  moderator_egzaminatorow: [
    { title: "Dodawanie egzaminatorów", body: "W panelu wpisz login i nazwę, kliknij „Dodaj”. Liczba kont na moderatora jest ograniczona przez właściciela." },
    { title: "Zawieszanie", body: "Kliknij „Zawieś”, podaj powód i opcjonalnie termin. Po terminie konto odblokuje się samo, możesz też odwiesić je ręcznie." },
    { title: "Usuwanie kont", body: "Nie usuwasz kont samodzielnie. Kliknij „Wniosek o usunięcie” i podaj powód, a admin go rozpatrzy. Dostaniesz powiadomienie o decyzji." },
  ],
  admin: [
    { title: "Wnioski o wpis", body: "Przyjmuj lub odrzucaj wnioski. Odrzucenie wymaga powodu, który zobaczy egzaminator." },
    { title: "Usuwanie wniosków osoby", body: "Wybierz egzaminatora i kliknij „Usuń wszystkie”. Operacja jest nieodwracalna, ale zapisuje się w dzienniku zdarzeń." },
    { title: "Wnioski o usunięcie kont", body: "Zatwierdzaj lub odrzucaj wnioski moderatorów. Zatwierdzenie usuwa konto egzaminatora." },
  ],
  wlasciciel: [
    { title: "Limity", body: "W ustawieniach ustalasz wszystkie limity: wnioski egzaminatora, konta na moderatora i wnioski o usunięcie na dobę." },
    { title: "Tryb awaryjny", body: "Jednym przyciskiem zamrażasz składanie wszystkich wniosków i odmrażasz je tak samo łatwo." },
    { title: "Dziennik zdarzeń", body: "Każda ważna akcja (zawieszenie, usunięcie, zmiana limitów) jest zapisana z wykonawcą i czasem." },
  ],
};

export function Tutorial({ role, userId }: { role: Role; userId: string }) {
  const key = `samouczek:${role}:${userId}`;
  const steps = STEPS[role] ?? [];
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  useEffect(() => {
    try { if (steps.length && !localStorage.getItem(key)) setOpen(true); } catch { /* brak localStorage */ }
  }, [key]);
  const close = () => { try { localStorage.setItem(key, "1"); } catch { /* ignore */ } setOpen(false); setI(0); };
  if (!steps.length) return null;
  const s = steps[i];
  return (
    <>
      <button className="ex-btn" onClick={() => setOpen(true)}>Samouczek</button>
      {open && (
        <div className="ex-tour-back" role="dialog" aria-modal="true" aria-label="Samouczek">
          <div className="ex-tour">
            <p className="ex-muted">Krok {i + 1} z {steps.length}</p>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
            <div className="ex-row" style={{ justifyContent: "space-between" }}>
              <button className="ex-btn" onClick={close}>Pomiń</button>
              <span className="ex-row">
                {i > 0 && <button className="ex-btn" onClick={() => setI(i - 1)}>Wstecz</button>}
                {i < steps.length - 1
                  ? <button className="ex-btn" onClick={() => setI(i + 1)}>Dalej</button>
                  : <button className="ex-btn" onClick={close}>Gotowe</button>}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
