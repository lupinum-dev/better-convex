import { signInAs } from '@lupinum/better-convex-nuxt/better-auth/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, internal } from './_generated/api'
import { initConvexTest } from './test.setup'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const code = (error: unknown) => (error as { data?: { code?: string } }).data?.code

/** Ann owns Acme with Bob (an admin); Cat owns an organization alone. */
async function setup() {
  const test = initConvexTest()
  const ids = await test.run(async (ctx) => {
    const user = (authId: string) =>
      ctx.db.insert('users', {
        authId,
        email: `${authId}@example.com`,
        name: authId,
        active: true,
      })
    const [ann, bob, cat] = [await user('ann'), await user('bob'), await user('cat')]
    const acme = await ctx.db.insert('organizations', { name: 'Acme' })
    const solo = await ctx.db.insert('organizations', { name: 'Solo' })
    const join = (organizationId: typeof acme, userId: typeof ann, role: 'owner' | 'admin') =>
      ctx.db.insert('memberships', { organizationId, userId, role, status: 'active' })
    await join(acme, ann, 'owner')
    const bobAtAcme = await join(acme, bob, 'admin')
    await join(solo, cat, 'owner')
    const projectId = await ctx.db.insert('projects', {
      organizationId: acme,
      name: 'Roadmap',
      status: 'active',
      createdBy: ann,
    })
    return { ann, bob, cat, acme, bobAtAcme, projectId }
  })
  return { test, ...ids, session: await signInAs(test, 'ann') }
}

describe('account safeguards', () => {
  // Catches: deleting the only owner of a team that still has members, which strands the team.
  it('refuses to delete the last owner of an organization that has other members', async () => {
    const { test, bobAtAcme } = await setup()
    const refuses = (authId: string) =>
      test.query(internal.accountDeletion.leavesATeamWithoutOwner, { authId })
    await expect(refuses('ann')).resolves.toBe(true)
    // Bob is no owner, and Cat is alone in her organization: nobody is left without an owner.
    await expect(refuses('bob')).resolves.toBe(false)
    await expect(refuses('cat')).resolves.toBe(false)
    await test.run((ctx) => ctx.db.patch(bobAtAcme, { role: 'owner' }))
    await expect(refuses('ann')).resolves.toBe(false)
  })

  // Catches: an account deletion that leaves the person's memberships and profile behind.
  it('erases the memberships and the profile of a deleted account, and keeps the team data', async () => {
    const { test, ann, bob, projectId } = await setup()
    await test.mutation(internal.auth.onDelete, { model: 'user', doc: { id: 'ann' } })
    await test.finishAllScheduledFunctions(vi.runAllTimers)
    const left = await test.run(async (ctx) => ({
      users: (await ctx.db.query('users').collect()).map((user) => user._id),
      memberships: (await ctx.db.query('memberships').collect()).map((row) => row.userId),
      project: await ctx.db.get(projectId),
    }))
    expect(left.users).not.toContain(ann)
    expect(left.memberships).not.toContain(ann)
    expect(left.memberships).toContain(bob)
    expect(left.project).toMatchObject({ name: 'Roadmap' })
  })

  // Catches: a missing write limit on the action that creates data.
  it('limits project creation to 30 a minute per person', async () => {
    const { session, acme } = await setup()
    for (let i = 0; i < 30; i++)
      await session.mutation(api.projects.create, { organizationId: acme, name: `P${i}` })
    await expect(
      session.mutation(api.projects.create, { organizationId: acme, name: 'One too many' }),
    ).rejects.toSatisfy((error) => code(error) === 'RATE_LIMITED')
  })

  // Catches: archiving a project without leaving a trace of who did it.
  it('records who archived a project in the audit log', async () => {
    const { test, session, projectId, acme } = await setup()
    await session.mutation(api.projects.archive, { projectId })
    const rows = await test.run((ctx) => ctx.db.query('auditLog').collect())
    expect(rows).toMatchObject([
      { action: 'projects.archive', actor: { kind: 'person' }, rows: [projectId] },
    ])
    expect(rows[0]!.tenantId).toBe(acme)
  })
})
