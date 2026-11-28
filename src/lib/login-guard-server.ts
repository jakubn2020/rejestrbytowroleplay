/**
 * Brute-force protection around the panel login: a per-address lockout and alerts.
 * Server-only; used by the login function in auth.functions.ts.
 */
import { autoBan, lockIp } from './ip-policy-server'
import {
  clientIp,
  countEvents,
  raiseAlert,
  recordEvent,
} from './security-server'

const WINDOW_MINUTES = 15
/** Failed logins from one address in the window after which that address is blocked. */
const MAX_FAILURES_PER_IP = 8
/**
 * Failed logins from one address within `LOCK_WINDOW_MINUTES` that count as a brute-force attack:
 * critical alert and the address is blocked on the whole site until the owner unblocks it by hand.
 */
export const LOCK_AFTER_FAILURES = 20
const LOCK_WINDOW_MINUTES = 24 * 60
/** Failures that raise an alert (without blocking, so nobody can lock out someone else). */
const ALERT_AFTER = 5

export async function loginBlocked(): Promise<boolean> {
  const ip = clientIp()
  if (!ip) return false
  const failures = await countEvents({
    kind: 'login_failed',
    ip,
    minutes: WINDOW_MINUTES,
  })
  return failures >= MAX_FAILURES_PER_IP
}

export async function registerLoginFailure(rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase().slice(0, 200)
  const ip = clientIp()
  await recordEvent({ kind: 'login_failed', identity: email, ip })
  if (ip) {
    const lastDay = await countEvents({ kind: 'login_failed', ip, minutes: LOCK_WINDOW_MINUTES })
    if (lastDay >= LOCK_AFTER_FAILURES) {
      const reason = `${lastDay} nieudanych logowań w ciągu 24 godzin (atak siłowy)`
      if (await lockIp(ip, reason)) {
        await raiseAlert({
          kind: 'ip_locked',
          ip,
          identity: email,
          details: `KRYTYCZNE: adres ${ip} wykonał ${lastDay} nieudanych logowań w ciągu 24 godzin (ostatnie konto: ${email}). Strona jest dla niego zablokowana do ręcznego odblokowania (Centrum bezpieczeństwa → Adresy IP i ruch).`,
          severity: 'critical',
        })
      }
      return
    }
    const fromIp = await countEvents({
      kind: 'login_failed',
      ip,
      minutes: WINDOW_MINUTES,
    })
    if (fromIp >= MAX_FAILURES_PER_IP) {
      await autoBan(ip, 60, `${fromIp} nieudanych logowań w ciągu ${WINDOW_MINUTES} minut`)
    }
    if (fromIp >= ALERT_AFTER) {
      await raiseAlert({
        kind: 'login_failures_ip',
        ip,
        details: `Adres ${ip}: ${fromIp} nieudanych logowań w ciągu ${WINDOW_MINUTES} minut${fromIp >= MAX_FAILURES_PER_IP ? ' (adres zablokowany)' : ''}.`,
        dedupeMinutes: WINDOW_MINUTES,
      })
    }
  }
  const forAccount = await countEvents({
    kind: 'login_failed',
    identity: email,
    minutes: WINDOW_MINUTES,
  })
  if (forAccount >= ALERT_AFTER) {
    await raiseAlert({
      kind: 'login_failures_account',
      identity: email,
      details: `Konto ${email}: ${forAccount} nieudanych logowań w ciągu ${WINDOW_MINUTES} minut.`,
      dedupeMinutes: WINDOW_MINUTES,
    })
  }
}
