import { unguardedFunctions } from '@lupinum/better-convex-functions/test'
import { expect, test } from 'vitest'

// Catches a function built with Convex's own builders instead of the ones from ./functions:
// it would skip the caller check, the policy and the row rules. Mark a deliberate one with
// `trusted(reason, fn)`.
test('every function goes through the policy and the row rules', () => {
  const modules = import.meta.glob<Record<string, unknown>>(
    ['./**/*.ts', '!./**/*.test.ts', '!./test.setup.ts', '!./*.config.ts', '!./_generated/**'],
    { eager: true },
  )
  const trustedRoutes = { '/api/auth/': 'Better Auth endpoints; the auth library checks each one.' }
  expect(unguardedFunctions(modules, { trustedRoutes })).toEqual([])
})
