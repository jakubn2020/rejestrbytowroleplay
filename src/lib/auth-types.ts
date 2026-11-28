/** The signed-in staff member as the browser sees it. */
export type AuthUser = {
  id: string
  email: string
  roles: string[]
  /** Owner powers: the owner account (SUPERADMIN_EMAIL) or a co-owner the owner named. */
  isSuperAdmin: boolean
  /** True only for the real owner account (SUPERADMIN_EMAIL): the one who names co-owners. */
  isRootOwner?: boolean
  /** The owner forced a password change: the panel only offers that until it is done. */
  mustChangePassword: boolean
  /** Permission keys the owner switched off for this person (the panel hides the matching buttons). */
  denied?: string[]
}
