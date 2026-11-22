/** Saves text as a file in the browser. */
export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** "PL" → flag emoji (country codes from Cloudflare; "T1" = Tor). */
export function countryLabel(code: string): string {
  if (code === 'T1') return 'Tor (sieć anonimowa)'
  if (!/^[A-Z]{2}$/.test(code)) return code
  const flag = String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
  return `${flag} ${code}`
}

/** "za 12 min", "za 3 godz." for temporary bans. */
export function remaining(iso: string | null, now = Date.now()): string {
  if (!iso) return 'bezterminowo'
  const minutes = Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 60_000))
  if (minutes < 60) return `jeszcze ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `jeszcze ${hours} godz. ${minutes % 60} min`
  return `jeszcze ${Math.ceil(hours / 24)} dni`
}
