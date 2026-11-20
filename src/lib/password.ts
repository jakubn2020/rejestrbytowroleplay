/**
 * Password hashing with PBKDF2-SHA256 through WebCrypto (works on Cloudflare Workers and Node).
 * Workers cap PBKDF2 at 100 000 iterations, so that is the value used everywhere.
 */
const ITERATIONS = 100_000
const KEY_BITS = 256

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

async function derive(password: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    KEY_BITS,
  )
  return new Uint8Array(bits)
}

/** Returns `pbkdf2$<iterations>$<salt hex>$<hash hex>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, salt, ITERATIONS)
  return `pbkdf2$${ITERATIONS}$${toHex(salt)}$${toHex(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, saltHex, hashHex] = stored.split('$')
  if (scheme !== 'pbkdf2' || !iterations || !saltHex || !hashHex) return false
  const actual = await derive(password, fromHex(saltHex), Number(iterations))
  const expected = fromHex(hashHex)
  if (actual.length !== expected.length) return false
  // Constant-time comparison.
  let diff = 0
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!
  return diff === 0
}
