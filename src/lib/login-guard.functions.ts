/**
 * Brute-force protection around the panel login. The password itself is checked by
 * Netlify Identity; these functions add a per-address lockout and alerts on top.
 * (They guard the login form; Identity's own throttling remains the last line of defence.)
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import {
  clientIp,
  countEvents,
  raiseAlert,
  recordEvent,
} from './security-server'

const WINDOW_MINUTES = 15
/** Failed logins from one address in the window after which that address is blocked. */
const MAX_FAILURES_PER_IP = 8
/** Failures that raise an alert (without blocking, so nobody can lock out someone else). */
const ALERT_AFTER = 5

export const checkLoginAllowed = createServerFn({ method: 'GET' }).handler(
  async () => {
    const ip = clientIp()
    if (!ip) return { allowed: true }
    const failures = await countEvents({
      kind: 'login_failed',
      ip,
      minutes: WINDOW_MINUTES,
    })
    return { allowed: failures < MAX_FAILURES_PER_IP }
  },
)

export const reportLoginFailure = createServerFn({ method: 'POST' })
  .validator(z.object({ email: z.string().trim().toLowerCase().max(200) }))
  .handler(async ({ data }) => {
    const ip = clientIp()
    await recordEvent({ kind: 'login_failed', identity: data.email, ip })
    if (ip) {
      const fromIp = await countEvents({
        kind: 'login_failed',
        ip,
        minutes: WINDOW_MINUTES,
      })
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
      identity: data.email,
      minutes: WINDOW_MINUTES,
    })
    if (forAccount >= ALERT_AFTER) {
      await raiseAlert({
        kind: 'login_failures_account',
        identity: data.email,
        details: `Konto ${data.email}: ${forAccount} nieudanych logowań w ciągu ${WINDOW_MINUTES} minut.`,
        dedupeMinutes: WINDOW_MINUTES,
      })
    }
    return { ok: true }
  })
