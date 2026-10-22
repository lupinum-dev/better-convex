import { launchProblems } from '@lupinum/better-convex-functions/test'
import { expect, test } from 'vitest'

import crons from './crons'
import { fns } from './functions'
import schema from './schema'
import { modules } from './test.setup'

// Catches the mistakes that hurt after launch: a raw Convex function, a table that keeps a
// person's data after they delete their account, housekeeping nobody schedules, a public write
// without a limit, and a tool that no agent sees. Each problem names the fix.
test('the app has no launch problems', async () => {
  const trustedRoutes = { '/api/auth/': 'Better Auth endpoints; the auth library checks each one.' }
  expect(await launchProblems({ modules, schema, crons, fns, trustedRoutes })).toEqual([])
})
