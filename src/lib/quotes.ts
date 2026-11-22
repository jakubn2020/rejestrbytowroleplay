/** Quotes of the day for the home page (public domain sayings, chosen by calendar day). */
export const QUOTES: { text: string; /** Empty for proverbs (no attribution line is shown). */ author: string }[] = [
  { text: 'Przede wszystkim nie szkodzić.', author: 'zasada przypisywana Hipokratesowi' },
  { text: 'Życie jest krótkie, sztuka długa.', author: 'Hipokrates' },
  { text: 'Pozwól, aby pożywienie było twoim lekarstwem.', author: 'przypisywane Hipokratesowi' },
  { text: 'Lekarstwo to sztuka naśladowania natury.', author: '' },
  { text: 'Pierwszym obowiązkiem szpitala jest nie szkodzić chorym.', author: 'Florence Nightingale' },
  { text: 'Obserwacja i doświadczenie to dwie nogi dobrego lekarza.', author: '' },
  { text: 'Słuchaj pacjenta: on sam podaje ci rozpoznanie.', author: 'William Osler (w duchu)' },
  { text: 'Dobry lekarz leczy chorobę, wielki lekarz leczy pacjenta.', author: 'William Osler' },
  { text: 'Medycyna jest nauką niepewności i sztuką prawdopodobieństwa.', author: 'William Osler' },
  { text: 'Dawka czyni truciznę.', author: 'Paracelsus' },
  { text: 'Salus aegroti suprema lex.', author: 'maksyma lekarska: dobro chorego najwyższym prawem' },
  { text: 'Czas jest najlepszym lekarzem.', author: '' },
  { text: 'Lepiej zapobiegać niż leczyć.', author: '' },
  { text: 'Higiena rąk ratuje więcej życia niż wiele leków.', author: '' },
  { text: 'Ratownik widzi człowieka, nie numer sprawy.', author: '' },
  { text: 'Troska to pierwsze lekarstwo.', author: '' },
  { text: 'Cierpliwość leczy to, czego nie wyleczy lek.', author: '' },
  { text: 'Kto ratuje jedno życie, ratuje cały świat.', author: 'Talmud' },
  { text: 'Zdrowie jest największym bogactwem.', author: '' },
  { text: 'Uśmiech pielęgniarki bywa lepszy niż zastrzyk.', author: '' },
]

/** The quote for today (Polish calendar day), the same for every visitor. */
export function quoteOfTheDay(now = new Date()) {
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(now)
  const index = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000)
  return QUOTES[index % QUOTES.length]
}
