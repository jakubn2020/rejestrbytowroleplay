/** Matching of IPv4/IPv6 addresses against a single address or a CIDR range (pure, no server imports). */

type Parsed = { bits: 32 | 128; value: bigint }

function parseV4(text: string): bigint | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  let value = 0n
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const n = Number(part)
    if (n > 255) return null
    value = (value << 8n) | BigInt(n)
  }
  return value
}

function parseV6(raw: string): bigint | null {
  let text = raw
  const zone = text.indexOf('%')
  if (zone >= 0) text = text.slice(0, zone)
  if (!/^[0-9a-fA-F:.]+$/.test(text) || !text.includes(':')) return null
  // Embedded IPv4 tail (::ffff:1.2.3.4).
  const lastColon = text.lastIndexOf(':')
  const tail = text.slice(lastColon + 1)
  if (tail.includes('.')) {
    const v4 = parseV4(tail)
    if (v4 === null) return null
    const hi = ((v4 >> 16n) & 0xffffn).toString(16)
    const lo = (v4 & 0xffffn).toString(16)
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  let groups: string[]
  if (halves.length === 2) {
    const missing = 8 - head.length - rest.length
    if (missing < 0) return null
    groups = [...head, ...new Array<string>(missing).fill('0'), ...rest]
  } else {
    groups = head
  }
  if (groups.length !== 8) return null
  let value = 0n
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null
    value = (value << 16n) | BigInt(parseInt(group, 16))
  }
  return value
}

function parseIp(text: string): Parsed | null {
  const clean = text.trim()
  const v4 = parseV4(clean)
  if (v4 !== null) return { bits: 32, value: v4 }
  const v6 = parseV6(clean)
  if (v6 !== null) {
    // IPv4-mapped IPv6 addresses count as the IPv4 address.
    if (v6 >> 32n === 0xffffn) return { bits: 32, value: v6 & 0xffffffffn }
    return { bits: 128, value: v6 }
  }
  return null
}

/** Is `rule` a valid single address or CIDR range? */
export function isValidRule(rule: string): boolean {
  const [addr, prefix, ...extra] = rule.trim().split('/')
  if (extra.length > 0) return false
  const parsed = parseIp(addr)
  if (!parsed) return false
  if (prefix === undefined) return true
  if (!/^\d{1,3}$/.test(prefix)) return false
  return Number(prefix) <= parsed.bits
}

/** Does `ip` fall under `rule` (an address or a CIDR range)? Invalid input never matches. */
export function ipMatchesRule(ip: string, rule: string): boolean {
  const target = parseIp(ip)
  const [addr, prefix] = rule.trim().split('/')
  const base = parseIp(addr)
  if (!target || !base || target.bits !== base.bits) return false
  const length = prefix === undefined ? base.bits : Number(prefix)
  if (!Number.isInteger(length) || length < 0 || length > base.bits) return false
  const shift = BigInt(base.bits - length)
  return target.value >> shift === base.value >> shift
}
