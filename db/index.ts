import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema.js'

type Db = ReturnType<typeof createDb>

function createDb() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Brak zmiennej DATABASE_URL')
  return drizzle({ client: neon(url), schema })
}

let instance: Db | null = null

/**
 * Created lazily on first use: on Cloudflare Workers the secrets are only
 * available while a request is being handled, not when the module loads.
 * The Neon HTTP driver is stateless, so reusing it between requests is safe.
 */
export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    instance ??= createDb()
    return Reflect.get(instance, prop, receiver)
  },
})
