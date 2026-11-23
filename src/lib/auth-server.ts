/** Role middleware shared by all protected server functions (kept free of server-only imports at module level). */
import { createMiddleware } from '@tanstack/react-start'

import { ROLE_ADMIN, ROLE_EXAMINER, ROLE_EXAM_MOD, ROLE_MANAGEMENT, hasPanelRole } from './registry'
import { getSessionUser } from './session-server'
import { mfaSatisfied } from './security-server'

const MFA_REQUIRED = 'Wymagane potwierdzenie kodem z e-maila'
const PASSWORD_CHANGE_REQUIRED = 'Wymagana zmiana hasła'

/** Lets `admin` and `kierownictwo` through; exposes who they are and whether they are admin. */
export const requireStaff = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const user = await getSessionUser()
    const roles = user?.roles ?? []
    const isAdmin = roles.includes(ROLE_ADMIN)
    if (!user || (!isAdmin && !roles.includes(ROLE_MANAGEMENT))) {
      throw new Error('Brak uprawnień')
    }
    if (user.mustChangePassword) throw new Error(PASSWORD_CHANGE_REQUIRED)
    const identity = user.email.toLowerCase()
    if (!(await mfaSatisfied(identity))) throw new Error(MFA_REQUIRED)
    return next({ context: { user, isAdmin, identity } })
  },
)

/** Admin only (e.g. deleting entries). `kierownictwo` is deliberately not accepted. */
export const requireAdmin = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const user = await getSessionUser()
    if (!user?.roles.includes(ROLE_ADMIN)) {
      throw new Error('Brak uprawnień administratora')
    }
    if (user.mustChangePassword) throw new Error(PASSWORD_CHANGE_REQUIRED)
    const identity = user.email.toLowerCase()
    if (!(await mfaSatisfied(identity))) throw new Error(MFA_REQUIRED)
    return next({ context: { user, identity } })
  },
)

/** The owner account only: managing admin accounts. */
export const requireSuperAdmin = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const user = await getSessionUser()
    if (!user?.isSuperAdmin) {
      throw new Error('Brak uprawnień właściciela')
    }
    if (user.mustChangePassword) throw new Error(PASSWORD_CHANGE_REQUIRED)
    const identity = user.email.toLowerCase()
    if (!(await mfaSatisfied(identity))) throw new Error(MFA_REQUIRED)
    return next({ context: { user, identity } })
  },
)

/** Any panel account (admin, kierownictwo, egzaminator, moderator): for things everybody may read, like notices. */
export const requirePanelUser = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const user = await getSessionUser()
    if (!user || !hasPanelRole(user.roles)) throw new Error('Brak uprawnień')
    if (user.mustChangePassword) throw new Error(PASSWORD_CHANGE_REQUIRED)
    const identity = user.email.toLowerCase()
    if (!(await mfaSatisfied(identity))) throw new Error(MFA_REQUIRED)
    return next({ context: { user, identity } })
  },
)

/** An examiner or a moderator of examiners (both file requests for entries within the owner's limits). */
export const requireExaminer = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const user = await getSessionUser()
    if (!user || !(user.roles.includes(ROLE_EXAMINER) || user.roles.includes(ROLE_EXAM_MOD))) {
      throw new Error('Brak uprawnień egzaminatora')
    }
    if (user.mustChangePassword) throw new Error(PASSWORD_CHANGE_REQUIRED)
    const identity = user.email.toLowerCase()
    if (!(await mfaSatisfied(identity))) throw new Error(MFA_REQUIRED)
    return next({ context: { user, identity } })
  },
)

/** A moderator of examiners (adds, suspends and asks to remove examiner accounts). */
export const requireExamMod = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const user = await getSessionUser()
    if (!user?.roles.includes(ROLE_EXAM_MOD)) throw new Error('Brak uprawnień moderatora')
    if (user.mustChangePassword) throw new Error(PASSWORD_CHANGE_REQUIRED)
    const identity = user.email.toLowerCase()
    if (!(await mfaSatisfied(identity))) throw new Error(MFA_REQUIRED)
    return next({ context: { user, identity } })
  },
)
