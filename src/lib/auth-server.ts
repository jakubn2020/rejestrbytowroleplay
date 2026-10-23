/** Server-only: role middleware shared by all protected server functions. */
import { createMiddleware } from '@tanstack/react-start'
import { getUser } from '@netlify/identity'

import { ROLE_ADMIN, ROLE_MANAGEMENT } from './registry'
import { mfaSatisfied } from './security-server'

const MFA_REQUIRED = 'Wymagane potwierdzenie kodem z e-maila'

/** Lets `admin` and `kierownictwo` through; exposes who they are and whether they are admin. */
export const requireStaff = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const user = await getUser()
    const roles = user?.roles ?? []
    const isAdmin = roles.includes(ROLE_ADMIN)
    if (!user || (!isAdmin && !roles.includes(ROLE_MANAGEMENT))) {
      throw new Error('Brak uprawnień')
    }
    const identity = (user.email ?? user.id).toLowerCase()
    if (!(await mfaSatisfied(identity))) throw new Error(MFA_REQUIRED)
    return next({ context: { user, isAdmin, identity } })
  },
)

/** Admin only (e.g. deleting entries). `kierownictwo` is deliberately not accepted. */
export const requireAdmin = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    const user = await getUser()
    if (!user?.roles?.includes(ROLE_ADMIN)) {
      throw new Error('Brak uprawnień administratora')
    }
    const identity = (user.email ?? user.id).toLowerCase()
    if (!(await mfaSatisfied(identity))) throw new Error(MFA_REQUIRED)
    return next({ context: { user, identity } })
  },
)
