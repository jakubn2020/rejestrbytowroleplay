/**
 * Creates (or resets) a panel account straight in the database.
 *
 *   DATABASE_URL="postgres://..." pnpm create-user <email> <hasło> [admin|kierownictwo]
 *
 * Use it once for the owner account (the e-mail you also set as SUPERADMIN_EMAIL);
 * afterwards the owner adds everyone else from the panel. Running it again for an
 * existing e-mail sets a new password and role.
 */
import { neon } from '@neondatabase/serverless'

import { hashPassword } from '../src/lib/password'

const [rawEmail, password, role = 'admin'] = process.argv.slice(2)
const url = process.env.DATABASE_URL

if (!url || !rawEmail || !password || !['admin', 'kierownictwo'].includes(role)) {
  console.error('Użycie: DATABASE_URL=... pnpm create-user <email> <hasło> [admin|kierownictwo]')
  process.exit(1)
}
if (password.length < 8) {
  console.error('Hasło musi mieć co najmniej 8 znaków.')
  process.exit(1)
}

const email = rawEmail.trim().toLowerCase()
const sql = neon(url)
const hash = await hashPassword(password)

await sql`
  insert into users (email, password_hash, roles, created_by)
  values (${email}, ${hash}, ${[role]}, 'create-user')
  on conflict (email) do update
    set password_hash = excluded.password_hash, roles = excluded.roles
`
console.log(`Gotowe: konto ${email} (${role}).`)
