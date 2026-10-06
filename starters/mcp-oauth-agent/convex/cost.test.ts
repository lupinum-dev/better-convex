import { countDocuments } from '@lupinum/better-convex-functions/test'
import { signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { expect, test } from 'vitest'

import { api } from './_generated/api'
import { initConvexTest } from './test.setup'

// Catches a change that makes a call read or write more than it did: an extra lookup per row,
// a missing index, a write in a read path. Each number is the budget; raise it on purpose.

async function setup() {
  const t = initConvexTest()
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', {
      authId: 'ann',
      email: 'ann@example.com',
      name: 'Ann',
      active: true,
    })
    const organizationId = await ctx.db.insert('organizations', { name: 'Acme' })
    await ctx.db.insert('memberships', { organizationId, userId, role: 'owner', status: 'active' })
    const projectIds = []
    for (const name of ['Roadmap', 'Launch', 'Hiring']) {
      projectIds.push(
        await ctx.db.insert('projects', {
          organizationId,
          name,
          status: 'active',
          createdBy: userId,
        }),
      )
    }
    return { organizationId, projectId: projectIds[0]! }
  })
  return { t, ...ids, ann: await signInAs(t, 'ann') }
}

test('a page of three projects', async () => {
  const { ann, organizationId } = await setup()
  const cost = await countDocuments(() =>
    ann.query(api.projects.search, {
      organizationId,
      paginationOpts: { numItems: 10, cursor: null },
    }),
  )
  // The session check (2), user, organization, membership, then the three rows of the page.
  expect(cost).toEqual({ reads: 8, writes: 0 })
})

test('renaming one project', async () => {
  const { ann, projectId } = await setup()
  const cost = await countDocuments(() =>
    ann.mutation(api.projects.rename, { projectId, name: 'Roadmap 2027' }),
  )
  // The session check (2), user, project, membership, and the patch's own read of the project.
  expect(cost).toEqual({ reads: 6, writes: 1 })
})
