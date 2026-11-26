import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import { requirePanelUser, requireSuperAdmin } from './auth-server'
import { ROLE_ADMIN } from './registry'
import { logEvent } from './security-server'
import {
  FLAG_KEYS,
  clearSetting,
  readFlag,
  readSetting,
  writeSetting,
} from './site-settings-server'

export type NoticeLevel = 'info' | 'warning'

export type OwnerControls = {
  noticePublic: string
  noticePublicLevel: NoticeLevel
  noticeStaff: string
  reportsOpen: boolean
  requestsOpen: boolean
  searchOpen: boolean
  verifyOpen: boolean
  examsOpen: boolean
}

/** Public: the banner for visitors, if the owner set one. */
export const getPublicNotice = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ text: string; level: NoticeLevel } | null> => {
    try {
      const text = (await readSetting(FLAG_KEYS.noticePublic))?.trim()
      if (!text) return null
      const level = (await readSetting(FLAG_KEYS.noticePublicLevel)) === 'warning' ? 'warning' : 'info'
      return { text, level }
    } catch {
      return null
    }
  },
)

/** Staff only: the owner's message shown in the panel after sign-in. */
export const getStaffNotice = createServerFn({ method: 'GET' })
  .middleware([requirePanelUser])
  .handler(async (): Promise<string | null> => {
    try {
      return (await readSetting(FLAG_KEYS.noticeStaff))?.trim() || null
    } catch {
      return null
    }
  })

export const getOwnerControls = createServerFn({ method: 'GET' })
  .middleware([requireSuperAdmin])
  .handler(async (): Promise<OwnerControls> => ({
    noticePublic: (await readSetting(FLAG_KEYS.noticePublic)) ?? '',
    noticePublicLevel: (await readSetting(FLAG_KEYS.noticePublicLevel)) === 'warning' ? 'warning' : 'info',
    noticeStaff: (await readSetting(FLAG_KEYS.noticeStaff)) ?? '',
    reportsOpen: await readFlag(FLAG_KEYS.reports),
    requestsOpen: await readFlag(FLAG_KEYS.requests),
    searchOpen: await readFlag(FLAG_KEYS.search),
    verifyOpen: await readFlag(FLAG_KEYS.verify),
    examsOpen: await readFlag(FLAG_KEYS.exams),
  }))

export const saveOwnerControls = createServerFn({ method: 'POST' })
  .middleware([requireSuperAdmin])
  .validator(
    z.object({
      noticePublic: z.string().trim().max(300),
      noticePublicLevel: z.enum(['info', 'warning']),
      noticeStaff: z.string().trim().max(500),
      reportsOpen: z.boolean(),
      requestsOpen: z.boolean(),
      searchOpen: z.boolean(),
      verifyOpen: z.boolean(),
      examsOpen: z.boolean(),
    }),
  )
  .handler(async ({ data, context }) => {
    if (data.noticePublic) await writeSetting(FLAG_KEYS.noticePublic, data.noticePublic)
    else await clearSetting(FLAG_KEYS.noticePublic)
    await writeSetting(FLAG_KEYS.noticePublicLevel, data.noticePublicLevel)
    if (data.noticeStaff) await writeSetting(FLAG_KEYS.noticeStaff, data.noticeStaff)
    else await clearSetting(FLAG_KEYS.noticeStaff)
    await writeSetting(FLAG_KEYS.reports, data.reportsOpen ? '1' : '0')
    await writeSetting(FLAG_KEYS.requests, data.requestsOpen ? '1' : '0')
    await writeSetting(FLAG_KEYS.search, data.searchOpen ? '1' : '0')
    await writeSetting(FLAG_KEYS.verify, data.verifyOpen ? '1' : '0')
    await writeSetting(FLAG_KEYS.exams, data.examsOpen ? '1' : '0')
    await logEvent({
      actor: context.identity,
      actorRole: ROLE_ADMIN,
      action: 'owner_controls',
      details: `Ogłoszenie dla odwiedzających: ${data.noticePublic ? 'włączone' : 'brak'}; dla obsługi: ${data.noticeStaff ? 'włączone' : 'brak'}; zgłoszenia: ${data.reportsOpen ? 'otwarte' : 'wyłączone'}; wnioski: ${data.requestsOpen ? 'otwarte' : 'wyłączone'}; wyszukiwarka: ${data.searchOpen ? 'włączona' : 'wyłączona'}; weryfikacja QR: ${data.verifyOpen ? 'włączona' : 'wyłączona'}; egzaminy: ${data.examsOpen ? 'włączone' : 'wyłączone'}`,
    })
    return { ok: true as const }
  })
