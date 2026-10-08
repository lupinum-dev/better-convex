import { unguardedFunctions } from '@lupinum/better-convex-functions/test'
import { expect, test } from 'vitest'

import { modules } from './test.setup'

// Catches a function built with Convex's own builders instead of the ones from ./functions:
// it would skip the caller check, the policy and the row rules. Mark a deliberate one with
// `trusted(reason, fn)`.
test('every function goes through the policy and the row rules', async () => {
  const trustedRoutes = { '/api/auth/': 'Better Auth endpoints; the auth library checks each one.' }
  expect(await unguardedFunctions(modules, { trustedRoutes })).toEqual([])
})
