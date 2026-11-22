const ROWS: { what: string; management: boolean | string; admin: boolean | string; owner: boolean | string }[] = [
  { what: 'Przeglądanie tabeli osób i wyszukiwanie', management: true, admin: true, owner: true },
  { what: 'Podgląd numeru PESEL', management: 'po kliknięciu (audytowane, z limitem)', admin: 'od razu', owner: 'od razu' },
  { what: 'Plakietki i kody QR', management: true, admin: true, owner: true },
  { what: 'Dodanie osoby', management: 'przez wniosek', admin: 'bezpośrednio', owner: 'bezpośrednio' },
  { what: 'Zmiana terminu ważności PWZ', management: 'przez wniosek', admin: 'bezpośrednio', owner: 'bezpośrednio' },
  { what: 'Edycja wpisu (PESEL, PWZ, status), cofanie zmian', management: false, admin: true, owner: true },
  { what: 'Działania zbiorcze i eksport CSV', management: false, admin: true, owner: true },
  { what: 'Kosz i usuwanie wpisów', management: false, admin: true, owner: true },
  { what: 'Rozpatrywanie wniosków i zgłoszeń', management: false, admin: true, owner: true },
  { what: 'Alerty, statystyki, dziennik zdarzeń', management: false, admin: true, owner: true },
  { what: 'Tryb awaryjny', management: false, admin: true, owner: true },
  { what: 'Konta kierownictwa (dodawanie, hasła)', management: false, admin: true, owner: true },
  { what: 'Konta administratorów', management: false, admin: false, owner: true },
  { what: 'Centrum bezpieczeństwa, blokady IP, lockdown', management: false, admin: false, owner: true },
  { what: 'Kopie zapasowe i przywracanie', management: false, admin: false, owner: true },
  { what: 'Logo, znak wodny, ogłoszenia, przełączniki funkcji', management: false, admin: false, owner: true },
  { what: 'Edycja dziennika zmian', management: false, admin: false, owner: true },
]

function Cell({ value }: { value: boolean | string }) {
  if (value === true) return <span className="text-emerald-700" aria-label="tak">tak</span>
  if (value === false) return <span className="text-muted-foreground" aria-label="nie">nie</span>
  return <span>{value}</span>
}

/** Owner only: who can do what, by role. */
export function PermissionsMatrix() {
  return (
    <div>
      <h3 className="text-sm font-semibold">Kto co może (uprawnienia ról)</h3>
      <div className="mt-2 overflow-x-auto rounded-md border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Działanie</th>
              <th className="px-3 py-2">Kierownictwo</th>
              <th className="px-3 py-2">Administrator</th>
              <th className="px-3 py-2">Właściciel</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {ROWS.map((row) => (
              <tr key={row.what}>
                <td className="px-3 py-2">{row.what}</td>
                <td className="px-3 py-2"><Cell value={row.management} /></td>
                <td className="px-3 py-2"><Cell value={row.admin} /></td>
                <td className="px-3 py-2"><Cell value={row.owner} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
