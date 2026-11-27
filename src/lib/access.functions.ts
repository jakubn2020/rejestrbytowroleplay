import { createServerFn } from '@tanstack/react-start'

import { ipBanned } from './ip-policy-server'

/** Public: is the caller's address blocked (automatic lock after a brute-force attack, ban or manual block)? */
export const checkAccess = createServerFn({ method: 'GET' }).handler(async () => ({
  blocked: await ipBanned(),
}))
