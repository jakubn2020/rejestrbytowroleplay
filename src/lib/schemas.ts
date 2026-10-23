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
  })
  .transform((value) => ({
    ...value,
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
}
