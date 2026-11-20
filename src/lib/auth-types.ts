/** The signed-in staff member as the browser sees it. */
export type AuthUser = {
  id: string
  email: string
  roles: string[]
  /** True only for the owner account (SUPERADMIN_EMAIL), which may also manage admin accounts. */
  isSuperAdmin: boolean
}
