import { z } from 'zod'

import { PESEL_MAX_LENGTH, PROFESSIONS, isParamedic } from './registry'

export const peselSchema = z
  .string()
  .trim()
  .min(1, 'PESEL nie może być pusty')
  .max(PESEL_MAX_LENGTH, `PESEL może mieć najwyżej ${PESEL_MAX_LENGTH} cyfr`)
  .regex(/^\d+$/, 'PESEL może składać się tylko z cyfr')

export const practitionerInput = z
  .object({
    pesel: peselSchema,
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    profession: z.enum(PROFESSIONS),
    specialization: z.string().trim().max(160).optional(),
    /** ISO date when the PWZ expires; null/absent = lifetime (admin only, ignored for requests). */
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .transform((value) => ({
    ...value,
    expiresAt: value.expiresAt ? new Date(value.expiresAt) : null,
    specialization:
      isParamedic(value.profession) ? null : value.specialization || null,
  }))

/** Validated data of a person to be added (paramedics never have a specialization). */
export type PractitionerData = {
  pesel: string
  firstName: string
  lastName: string
  profession: string
  specialization: string | null
  expiresAt?: Date | null
}

/** Screenshot of the message (PNG / JPEG / WebP, never SVG), up to ~1.5 MB after compression. */
export const proofSchema = z
  .string()
  .max(2_000_000, 'Zrzut ekranu jest zbyt duży')
  .regex(
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/,
    'Dołącz zrzut ekranu jako obraz PNG, JPEG lub WebP',
  )
