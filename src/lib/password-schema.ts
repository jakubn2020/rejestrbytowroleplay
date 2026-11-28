import { z } from 'zod'

import { PASSWORD_MIN_LENGTH, PASSWORD_RULES_ERROR, meetsPasswordPolicy } from './password-strength'

/** Zod schema for every NEW password (min. 10 characters, a digit and a special character). */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, PASSWORD_RULES_ERROR)
  .max(200)
  .refine(meetsPasswordPolicy, PASSWORD_RULES_ERROR)
