import { signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { expect, test } from 'vitest'

import { api } from './_generated/api'
import type * as projects from './projects'
import { initConvexTest } from './test.setup'

// Catches a forgotten tenant check: a project of an organization Ann does not belong to (the
// canary) must never be returned or changed by any operation, whatever IDs she sends.
test('no operation returns or changes another organization’s project', async () => {
  const t = initConvexTest()
  const { own, foreign, canary } = await t.run(async (ctx) => {
    /** A user who owns an organization of their own. */
    const owner = async (authId: string) => {
      const userId = await ctx.db.insert('users', {
        authId,
        email: `${authId}@example.com`,
        name: authId,
        active: true,
      })
      const organizationId = await ctx.db.insert('organizations', { name: `${authId}'s` })
      await ctx.db.insert('memberships', {
        organizationId,
        userId,
        role: 'owner',
        status: 'active',
      })
      return { userId, organizationId }
    }
    const ann = await owner('ann')
    const bob = await owner('bob')
    const canary = await ctx.db.insert('projects', {
      organizationId: bob.organizationId,
      name: 'Canary',
      status: 'active',
      createdBy: bob.userId,
    })
    return { own: ann.organizationId, foreign: bob.organizationId, canary }
  })
  const ann = await signInAs(t, 'ann')
  const paginationOpts = { numItems: 100, cursor: null }

  // One call per operation, each aimed at the canary. A new operation must be added here.
  const calls: Record<keyof typeof projects, () => Promise<unknown>> = {
    organizations: () => ann.query(api.projects.organizations, { paginationOpts }),
    search: async () => [
      await ann.query(api.projects.search, { organizationId: own, text: 'Canary', paginationOpts }),
      await ann.query(api.projects.search, { organizationId: foreign, paginationOpts }),
    ],
    create: () => ann.mutation(api.projects.create, { organizationId: foreign, name: 'Mine' }),
    rename: () => ann.mutation(api.projects.rename, { projectId: canary, name: 'Mine' }),
    archive: () => ann.mutation(api.projects.archive, { projectId: canary }),
  }
  const before = await t.run((ctx) => ctx.db.get(canary))
  for (const call of Object.values(calls)) {
    const outcome = await call().then(
      (result) => JSON.stringify(result),
      (error: { data?: { code?: string } }) => error.data?.code ?? String(error),
    )
    expect(outcome).not.toMatch(/Canary|bob/)
    expect(outcome).not.toContain(canary)
  }
  await expect(t.run((ctx) => ctx.db.get(canary))).resolves.toEqual(before)
  // Nothing was created in Bob's organization either.
  await expect(t.run((ctx) => ctx.db.query('projects').collect())).resolves.toHaveLength(1)
})
