import { countDocuments } from '@lupinum/better-convex-functions/test'
import { convexTest } from 'convex-test'
import { makeFunctionReference } from 'convex/server'
import { expect, test } from 'vitest'

import schema from './app/schema'

// D6: what one call costs, in documents read and written, with everything the
// library does around the handler (user, role, tenant rows). Each number is
// the budget: a change that reads or writes more fails here and has to say why.

const modules = import.meta.glob(['./app/*.ts', './app/_generated/*.ts'])
const fn = (path: string) => makeFunctionReference<any>(path)

/** Ann owns organization A, with one project. */
async function setup() {
  const t = convexTest({ schema, modules, transactionLimits: true })
  const ids = await t.run(async (ctx) => {
    const ann = await ctx.db.insert('users', { authId: 'ann', name: 'Ann', active: true })
    const a = await ctx.db.insert('organizations', { name: 'A' })
    await ctx.db.insert('memberships', { organizationId: a, userId: ann, role: 'owner' })
    const pa = await ctx.db.insert('projects', {
      organizationId: a,
      name: 'A one',
      status: 'active',
    })
    return { a, pa }
  })
  return { t, ...ids, ann: t.withIdentity({ subject: 'ann' }) }
}

test('a page of a paginated list query', async () => {
  const { t, ann, a } = await setup()
  await t.run(async (ctx) => {
    for (const name of ['A two', 'A three'])
      await ctx.db.insert('projects', { organizationId: a, name, status: 'active' })
  })
  const cost = await countDocuments(() =>
    ann.query(fn('projects:search'), {
      organizationId: a,
      paginationOpts: { numItems: 10, cursor: null },
    }),
  )
  // User, organization, membership, then the three rows of the page: the rule check adds no reads.
  expect(cost).toEqual({ reads: 6, writes: 0 })
})

test('a single-row mutation under a tenant rule', async () => {
  const { ann, pa } = await setup()
  // User, project (for its tenant), membership, and the patch's own read; the handler's get is the cached row.
  expect(
    await countDocuments(() => ann.mutation(fn('projects:archive'), { projectId: pa })),
  ).toEqual({ reads: 4, writes: 1 })
})

test('a write in a nested tenant (client under an organization)', async () => {
  const { ann, a } = await setup()
  // User, organization, membership; the insert's parent check reuses the role.
  expect(
    await countDocuments(() =>
      ann.mutation(fn('clients:create'), { organizationId: a, name: 'Client' }),
    ),
  ).toEqual({ reads: 3, writes: 1 })
})
